const acorn = require('acorn');
const path = require('path');
const fs = require('fs');
const estraverse = require('estraverse');
const md5 = require('md5');
const escodegen = require('escodegen');
const UglifyJS = require('uglify-es');

const Resolver = require('./resolver');

const MODULES = {};

function commonJSWrapperTemplate(id, source) {
    return `const require_${id} = (function() { 
        const module = { exports: {}};
        const exports = module.exports;
    
        ${source}
        
        return module.exports;
    });`;
}

function iifeTemplate(source) {
    return `(function() {${source}}())`;
}

function sourceToAST(source) {
    return acorn.parse(source, {
        ecmaVersion: 2018
    });
}

// root path should be where the bundler was invoked from
// source path should be where the inital file was loaded from
function walkAndParse(ast, currentPath, resolver) {
    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] && node.arguments[0] && node.arguments[0].type === 'Literal') {
                    const modulePath = node.arguments[0].value;
                    const { fullPath, newResolutionPath } = resolver.resolvePath(modulePath, currentPath);

                    let resolved = fs.readFileSync(fullPath, 'UTF-8');

                    const id = md5(resolved);
                    
                    const module = {
                        node,
                        resolvedModule: resolved,
                        modulePath: modulePath,
                        fullPath: fullPath,
                        exports: wrapSourceAndParse(resolved, newResolutionPath, id, resolver),
                        id: id
                    }

                    node.callee.name = `require_${id}`;
                    MODULES[id] = module;
                }
            }

            if (node.type === 'IfStatement') {
                // This allows us to generate different bundles based on the NODE_ENV value, allowing develpoment and production builds
                // needs to be a binary expression
                if (node.test.type !== 'BinaryExpression') return;
                // check if either left or right are memeber expressions that look for the node env
                // check if either the left or right string literal, if it is lets build and compare the two
                const { left, right, operator } = node.test;

                if ((left.type === 'MemberExpression' || right.type === 'MemberExpression') && (left.type === 'Literal' || right.type === 'Literal')) {
                    // the member expression and literal can be on either side of the test so figure that out and assign to variables
                    const member = right.type === 'MemberExpression' ? right : left;
                    const literal = right.type === 'Literal' ? right : left;

                    // figure out if the member expression is actually referenceing process.env.NODE_ENV if not return early
                    if (member.object.type !== 'MemberExpression' || member.object.object === undefined || member.object.object.name !== 'process') return;
                    if (member.object.property.name !== 'env' && member.property.name !== 'NODE_ENV') return;


                    const { value } = literal;
                    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function
                    const result = new Function(`return "${value}" ${operator} "${process.env.NODE_ENV}"`)();

                    // create a block scope in order to maintain the scope of consequent or alternate block that is executed
                    const block = sourceToAST('{}').body[0];

                    /**
                     * If the value was true then set the blocks body to the consequent
                     * If the value was false and there is an alternate set the blocks body to the alternate
                     * If there is not alternate remove the entire node
                     */
                    if (result) {
                        block.body = node.consequent.body;
                        return block;
                    }

                    if (result === false) {
                        if (node.alternate && node.alternate.body) {
                            block.body = node.alternate.body;
                            return block;
                        }

                        this.remove();
                    }
                }
            }

            return node;
        }
    });

    return ast;
}

/**
 * Wraps the resolved source in the common JS templates
 * Converts to an new Abstract Syntax Tree
 * Walks the AST and parers any call expressions for require function calls
 */

function wrapSourceAndParse(resolvedSource, currentPath, id, resolver) {
    const wrappedSource = commonJSWrapperTemplate(id, resolvedSource);
    const resolvedAST = sourceToAST(wrappedSource);
    return walkAndParse(resolvedAST, currentPath, resolver);
}

/**
 * Converts all the parsed modules back to JS and appends together.
 * Converts the initalisation module and appends to the end.
 */

function generateCode(init, modules) {
    let generatedCode = Object.values(modules).map(value => escodegen.generate(value.exports)).join('');
    let initaliser = escodegen.generate(init);
    return `${generatedCode}\n${initaliser}`;
}

function compress(code) {
    if (process.env.NODE_ENV === 'production') {
        return UglifyJS.minify(iifeTemplate(code)).code;
    }

    return code;
}

function bundler(entryPoint, out) {
    const start = process.hrtime();
    
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;
    const init = fs.readFileSync(MODULE_PATH, 'UTF-8');
    const initalAST = sourceToAST(init);
    const resolver = new Resolver(ROOT_PATH);
    const parsedIntialAST = walkAndParse(initalAST, ROOT_PATH, resolver);
    const code = generateCode(parsedIntialAST, MODULES);
    let result = compress(iifeTemplate(code));

    fs.writeFileSync(OUT_PATH, result, 'UTF-8');

    const end = process.hrtime(start);
    console.log(`Took: ${end[0]}s ${end[1] / 1000000}ms`);
}

bundler('demo/index.js', `generated.js`);
