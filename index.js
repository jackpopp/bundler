const acorn = require('acorn');
const walk = require("acorn/dist/walk");
const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const escodegen = require('escodegen');

const ROOT_PATH = './demo/';
const PATH = `${ROOT_PATH}a.js`;

const init = fs.readFileSync(PATH);

function sourceToAST(source) {
    return JSON.parse(JSON.stringify(acorn.parse(source, {
        ecmaVersion: 2018,
        locations: false
    })));    
}

const initalAST = sourceToAST(init);

//walk(body);
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
const resolvedModules = {

};

const GRAPH = {};
const ARRAY_GRAPH = [];

const start = process.hrtime();

const template = `const require_{{__id__}} = (function() { 
    const module = { exports: {}};
    const exports = module.exports;
    /* code goes here */
    {{__code__}}
    /* return the export here */
    return module.exports;
});`;

const asts = [];

function walkAndParse(ast, currentPath) {
    // ast add a property called ast mods and push to that
    // once each ast has a list of mods we go through and push those nodes in to the parent and shift all the rest along
    let fullPath;
    walk.simple(ast, {
        CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]) {
                const modulePath = node.arguments[0].value; 
                fullPath = `${(currentPath ||ROOT_PATH)}${modulePath}`;

                /* 
                    this path with normalise the path to the relative directory thats being looked for
                    it will append whatever the current directory path is relative to the entry point module
                    bit more work to do with figuring out the resolver
                */
                const currentPathRelativeToBasePath = `${ROOT_PATH}${path.dirname(modulePath)}/`;

                let resolved
                if (resolvedModules[fullPath]) {
                    resolved = resolvedModules[fullPath];
                    console.log('cache')
                } else {
                    resolved = fs.readFileSync(fullPath, 'UTF-8');
                    resolvedModules[fullPath] = resolved;
                }
    
                // if the edge hasnt been added then add it
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
                    asts.push(ast);
                }

                //console.log(ast);
                ARRAY_GRAPH.push(edge);
            }
           
            // needs to be type literal
        }
    });

    ast.fullPath = fullPath;
    return ast;
}

const parsedIntialAST = walkAndParse(initalAST);

//console.log(asts);
console.log(GRAPH);

let code = Object.keys(GRAPH).map((key, value) => escodegen.generate(GRAPH[key].exports)).join('\n');
code += escodegen.generate(parsedIntialAST);
//code += escodegen.generate(asts[asts.length - 1]);

//const code = asts.map(ast => escodegen.generate(ast)).join('\n');
fs.writeFileSync(`${__dirname}/generated.js`, code, 'UTF-8')

const end = process.hrtime(start);
console.log(`Took: ${end[0]}s ${end[1]/1000000}ms`);

/**
 * look for module.exports = {} or exports = {}
 * look for exports.something = something
 * 
 */

function parseExports(resolvedSource, currentPath, id) {
    const wrappedSource = template.replace('{{__code__}}', resolvedSource).replace('{{__id__}}', id);

    const resolvedAST = sourceToAST(wrappedSource);
    return walkAndParse(resolvedAST, currentPath);

    //console.log(JSON.stringify(resolvedAST, null, 2));
    //process.exit(0);
}

/*example*/

var requirable_x = (function() { 
    const module = { exports: {}};
    const exports = module.exports;
    /* code goes here */
    {{code}}
    /* return the export here */
    return module.exports;
});