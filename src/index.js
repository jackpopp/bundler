const acorn = require('acorn');
const walk = require("acorn/dist/walk");
const fs = require('fs');
const md5 = require('md5');
const escodegen = require('escodegen');

const Resolver = require('./resolver');

const resolvedModules = {};
const GRAPH = {};

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
        ecmaVersion: 2018,
        locations: false
    });
}

// root path should be where the bundler was invoked from
// source path should be where the inital file was loaded from
function walkAndParse(ast, currentPath, resolver) {
    
    walk.ancestor(ast, {
        CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] && node.arguments[0] && node.arguments[0].type === 'Literal') {
                const modulePath = node.arguments[0].value;
                const { fullPath, newResolutionPath} = resolver.resolvePath(modulePath, currentPath);
 
                let resolved
                if (resolvedModules[fullPath]) {
                    resolved = resolvedModules[fullPath];
                } else {
                    /*
                        if full path is undefined then its probably a native node module
                        maybe use this shim  - https://github.com/webpack/node-libs-browser
                        ultra hack for now, remove this
                    */
                    if (fullPath === undefined) {
                        resolved = require(modulePath).toString();
                        resolvedModules[modulePath] = resolved;
                        return
                    }

                    resolved = fs.readFileSync(require.resolve(fullPath), 'UTF-8');
                    resolvedModules[fullPath] = resolved;
                }

                const id = md5(resolved);
                const edge = {
                    node,
                    resolvedModule: resolved,
                    modulePath: modulePath,
                    fullPath: fullPath,
                    exports: parseExports(resolved, newResolutionPath, id, resolver),
                    id: id
                }

                node.callee.name = `require_${id}`;

                if (GRAPH[id] === undefined) {
                    GRAPH[id] = (edge);
                }
            }
        },
        IfStatement(node) { 
            // This mod allows us to generate different bundles based on the NODE_ENV value, allowing develpoment and production builds
            const { left, right, operator } = node.test;
            // needs to be a binary expression
            // check if either left or right are memeber expressions that look for the node env
            // check if either the left or right string literal, if it is lets build and compare the two
            if (node.test.type !== 'BinaryExpression') return;

            if ((left.type === 'MemberExpression' || right.type === 'MemberExpression') && (left.type === 'Literal' || right.type === 'Literal')) {
                const member = right.type === 'MemberExpression' ? right : left;
                const literal = right.type === 'Literal' ? right : left;

                // JS is evaulated right to left so `env` object with be acessible on the first object key, `processs` on the next, even though its coded the other way around
                if (member.object.type !== 'MemberExpression' || member.object.object === undefined || member.object.object.name !== 'process') return;
                if (member.object.property.name !== 'env' && member.property.name !== 'NODE_ENV') return;


                const { value } = literal;
                // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function
                const result = new Function(`return "${value}" ${operator} "${process.env.NODE_ENV}"`)();
                

                // this is kinda nasty but you should have seen how I was trying to achieve this effect before 
                // https://github.com/jackpopp/bundler/blob/master/src/index.js#L183 mega hack and both versions of the scripts we bundled but only one executed
                const newTest = sourceToAST('true');
                node.test = newTest.body[0].expression;

                if (result === true && node.alternate && node.alternate.body) {
                    node.alternate.body = [];
                }

                if (result === false) {
                    if (node.alternate && node.alternate.body) {
                        node.consequent.body = node.alternate.body;
                        return;
                    }

                    node.consequent.body = [];
                }
            }
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

function generateCode(init, graph) {
    let modules = Object.keys(graph).map((key, value) => escodegen.generate(graph[key].exports)).join('\n');
    let initaliser = escodegen.generate(init);
    return `${modules}\n${initaliser}`;
}

const start = process.hrtime();

function bundler(entryPoint) {
    const ROOT_PATH = `${process.cwd()}/demo/`;
    const PATH = `${ROOT_PATH}/a.js`;
    const resolver = new Resolver(ROOT_PATH);
    const init = fs.readFileSync(require.resolve(PATH), 'UTF-8');
    const initalAST = sourceToAST(init);
    const parsedIntialAST = walkAndParse(initalAST, ROOT_PATH, resolver);
    const code = generateCode(parsedIntialAST, GRAPH);

    return iifeTemplate(code);

   
}

const code = bundler('');
fs.writeFileSync(`${__dirname}/generated.js`, code, 'UTF-8')

const end = process.hrtime(start);
console.log(`Took: ${end[0]}s ${end[1] / 1000000}ms`);
