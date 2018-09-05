/*
walk nodes
find requires
require the file
add the node to the graph
start/end of that section
once complete
generate the new code blob for each and insert using the resverse insert on source method
https://esprima.readthedocs.io/en/latest/syntactic-analysis.html#example-console-calls-removal
*/

const acorn = require('acorn');
const walk = require("acorn/dist/walk");
const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const escodegen = require('escodegen');

const resolvedModules = {};
const GRAPH = {};

const ROOT_PATH = './demo/';
const PATH = `${ROOT_PATH}a.js`;

const cjs_template = `const require_{{__id__}} = (function() { 
    const module = { exports: {}};
    const exports = module.exports;
    /* code goes here */
    {{__code__}}
    /* return the export here */
    return module.exports;
});`;

function sourceToAST(source) {
    return acorn.parse(source, {
        ecmaVersion: 2018,
        locations: false
    });    
}

// root path should be where the bundler was invoked from
// source path should be where the inital file was loaded from
function walkAndParse(ast, currentPath) {
    let fullPath;
    walk.simple(ast, {
        CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]) {
                const modulePath = node.arguments[0].value; 
                fullPath = `${(currentPath ||ROOT_PATH)}${modulePath}`;

                /* 
                    this path with normalise the path to the relative directory thats being looked for
                    it will append whatever the current directory path is relative to the entry point module
                    bit more work to do with figuring out the resolver, including trying node modules etc
                */
                const currentPathRelativeToBasePath = `${ROOT_PATH}${path.dirname(modulePath)}/`;

                let resolved
                if (resolvedModules[fullPath]) {
                    resolved = resolvedModules[fullPath];
                } else {
                    resolved = fs.readFileSync(fullPath, 'UTF-8');
                    resolvedModules[fullPath] = resolved;
                }
    
                const id = md5(resolved);
                const edge = {
                    node,
                    resolvedModule: resolved,
                    modulePath: modulePath,
                    fullPath: fullPath,
                    exports: parseExports(resolved, currentPathRelativeToBasePath, id),
                    id: id
                }

                node.callee.name = `require_${id}`;

                if (GRAPH[id] === undefined) {
                    GRAPH[id] = (edge);
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

function parseExports(resolvedSource, currentPath, id) {
    const wrappedSource = cjs_template.replace('{{__code__}}', resolvedSource).replace('{{__id__}}', id);
    const resolvedAST = sourceToAST(wrappedSource);
    return walkAndParse(resolvedAST, currentPath);
}

function generateCode(init, graph) {
    let modules = Object.keys(graph).map((key, value) => escodegen.generate(graph[key].exports)).join('\n');
    let initaliser = escodegen.generate(init);
    return `${modules}\n${initaliser}`;
}

const start = process.hrtime();

const init = fs.readFileSync(PATH);
const initalAST = sourceToAST(init);
const parsedIntialAST = walkAndParse(initalAST);
const code = generateCode(parsedIntialAST, GRAPH);
fs.writeFileSync(`${__dirname}/generated.js`, code, 'UTF-8')


const end = process.hrtime(start);
console.log(`Took: ${end[0]}s ${end[1]/1000000}ms`);