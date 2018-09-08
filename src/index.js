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

function sourceToAST(source) {
    return acorn.parse(source, {
        ecmaVersion: 2018,
        locations: false
    });
}

// root path should be where the bundler was invoked from
// source path should be where the inital file was loaded from
function walkAndParse(ast, currentPath) {
    walk.simple(ast, {
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
                    exports: parseExports(resolved, newResolutionPath, id),
                    id: id
                }

                node.callee.name = `require_${id}`;

                if (GRAPH[id] === undefined) {
                    GRAPH[id] = (edge);
                }
            }
        },
        IfStatement(node) {
            const { left, right } = node.test;
            process.exit(0);
        }
    });

    return ast;
}

/**
 * Wraps the resolved source in the common JS templates
 * Converts to an new Abstract Syntax Tree
 * Walks the AST and parers any call expressions for require function calls
 */

function parseExports(resolvedSource, currentPath, id) {
    const wrappedSource = cjsTemplate(id, resolvedSource);
    const resolvedAST = sourceToAST(wrappedSource);
    return walkAndParse(resolvedAST, currentPath);
}

function generateCode(init, graph) {
    let modules = Object.keys(graph).map((key, value) => escodegen.generate(graph[key].exports)).join('\n');
    let initaliser = escodegen.generate(init);
    return `${modules}\n${initaliser}`;
}

const start = process.hrtime();
const ROOT_PATH = `${process.cwd()}/demo/`;
const PATH = `${ROOT_PATH}/a.js`;
const resolver = new Resolver(ROOT_PATH);
const init = fs.readFileSync(require.resolve(PATH));
const initalAST = sourceToAST(init);
const parsedIntialAST = walkAndParse(initalAST, ROOT_PATH);
const code = generateCode(parsedIntialAST, GRAPH);

/*
    lol this need to go in the parser checking if statements and removing the block
    lol this need to go in the parser checking if statements and removing the block
    visit the if statement
    if the check is to check the node env process 
    then check what mode we're in 
    if any dont match the statements and we find a require call within 
    then mark it
*/
const processWrapper = `
    window.process = {
        env: {
            NODE_ENV: 'development'
        }
    };
    process.env.NODE_ENV;`;

const iffe = `(function() {${processWrapper}\n${code}}())`;

fs.writeFileSync(`${__dirname}/generated.js`, iffe, 'UTF-8')


const end = process.hrtime(start);
console.log(`Took: ${end[0]}s ${end[1] / 1000000}ms`);
