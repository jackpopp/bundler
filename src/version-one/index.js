const acorn = require('acorn');
const path = require('path');
const fs = require('fs');
const estraverse = require('estraverse');
const md5 = require('md5');
const escodegen = require('escodegen');
const UglifyJS = require('uglify-es');

const Resolver = require('./resolver');

const cacheModuleFile = {};
const MODULES = {};

function cjsTemplate(id, source) {
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
                    const { fullPath, newResolutionPath} = resolver.resolvePath(modulePath, currentPath);
    
                    let resolved
                    if (cacheModuleFile[fullPath]) {
                        resolved = cacheModuleFile[fullPath];
                    } else {
                        /*
                            if full path is undefined then its probably a native node module
                            maybe use this shim  - https://github.com/webpack/node-libs-browser
                            ultra hack for now, remove this
                        */
                        if (fullPath === undefined) {
                            resolved = require(modulePath).toString();
                            cacheModuleFile[modulePath] = resolved;
                        }

                        resolved = fs.readFileSync(require.resolve(fullPath), 'UTF-8');
                        cacheModuleFile[fullPath] = resolved;
                    }

                    const id = md5(resolved);
                    
                    const vertex = {
                        node,
                        resolvedModule: resolved,
                        modulePath: modulePath,
                        fullPath: fullPath,
                        exports: parseExports(resolved, newResolutionPath, id, resolver),
                        id: id
                    }

                    node.callee.name = `require_${id}`;

                    if (MODULES[id] === undefined) {
                        MODULES[id] = (vertex);
                    }
                }
            }

            if (node.type === 'IfStatement') {
                // This mod allows us to generate different bundles based on the NODE_ENV value, allowing develpoment and production builds
                const { left, right, operator } = node.test;
                // needs to be a binary expression
                // check if either left or right are memeber expressions that look for the node env
                // check if either the left or right string literal, if it is lets build and compare the two
                if (node.test.type !== 'BinaryExpression') return;

                if ((left.type === 'MemberExpression' || right.type === 'MemberExpression') && (left.type === 'Literal' || right.type === 'Literal')) {
                    const member = right.type === 'MemberExpression' ? right : left;
                    const literal = right.type === 'Literal' ? right : left;

                    if (member.object.type !== 'MemberExpression' || member.object.object === undefined || member.object.object.name !== 'process') return;
                    if (member.object.property.name !== 'env' && member.property.name !== 'NODE_ENV') return;


                    const { value } = literal;
                    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function
                    const result = new Function(`return "${value}" ${operator} "${process.env.NODE_ENV}"`)();

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

function parseExports(resolvedSource, currentPath, id, resolver) {
    const wrappedSource = cjsTemplate(id, resolvedSource);
    const resolvedAST = sourceToAST(wrappedSource);
    return walkAndParse(resolvedAST, currentPath, resolver);
}

/**
 * Converts all the parsed modules back to JS and appends together.
 * Converts the initalisation module and appends to the end.
 */

function generateCode(init, modules) {
    let generatedCode = Object.keys(modules).map((key, value) => escodegen.generate(modules[key].exports)).join('\n');
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
