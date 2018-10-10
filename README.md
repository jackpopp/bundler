# Building a Javascript module bunder

## Introduction

*Source*: https://github.com/jackpopp/bundler/blob/master/src/index.js

A Javascript module bundler is a tool that allows you to bundle multiple Javascript modules together in to a single or multiple output files. Separating your JS code into multiple modules and requiring shared modules from package management repositories is a common practice in modern web development. Javascript in the browser has not natively supported modules (although some browsers are starting to) and so module bundling is required to glue all the modules together. There's several different ways that modules can be bundled including AMD, Common JS and Import methods, the Javascript runtime Node popularised Common JS and we'll build our bundler to support this. There's several popular Javascript bundlers that have been around for a while webpack being one of the most common, others include Rollup, Browserify and Parcel.

The bundler takes Javascript source code, processes it, transforms it in someway and then outputs a different form of the source code. In our case we're taking the individual Javascript source files and bundling them together while rewriting specific pieces of code, for example the require function calls that the Common JS module format uses. Most bundlers will build a dependency graph using a graph data structure (https://en.wikipedia.org/wiki/Dependency_graph), which can be used for generating the JS bundle, visualisation and code splitting. In this bundler we will simplify a few things, for example forgoing a fully directed dependency graph and just using an object to store our bundles, we will also resolve modules synchronously which will be slower but allow for simpler code. 

### TL:DR
The basic steps for bundling our modules are as follow:

- Transform the initial source code to an Abstract Syntax Tree using acorn
- Traverse the Abstract Syntax Tree and detect require function calls
- Resolve modules by processing call expressions that have a callee named require
- Wrap resolved modules in common JS helper function
- For each resolved module, generate an Abstract Syntax Tree and recursively transverse that Abstract Syntax Tree
- Add each modified Abstract Syntax Tree to a modules object
- Iterate over the Abstract Syntax Trees collection converting each to code using escodegen
- Wrap in an immediately invoked function expression
- Write bundle to file

The bundler begins by reading the entry point JS file file and converting this to an Abstract Syntax Tree (AST) following the ecmascript 2018 specification (https://www.ecma-international.org/ecma-262/9.0/index.html#Title). 
An AST is a tree representation of the source code with each node representing a construct in the language.
To parse the initial source file to an AST we can use the acorn module, the resultant AST follows the estree implementation of the 2018 Ecmascript specification which can be found here (https://github.com/estree/estree).
Using the specification we can figure out which nodes we want to look for and modify in order to bundle all our code together.
We'll take the AST and we'll use the estraverse module to traverse the nodes, visiting each node checking the type then modifying, replacing or removing.
This will need to happen recursively for all common JS require function calls that we find.

### Initial Set up

Create a directory called bundler for all our source code, in here add an src directory for the bundler source and demo directory for our demo project.
initialise a package.json in the root directory and in the demo directory, we'll need a package.json in the demo directory to test bundling node modules that we've installed in our demo project.

```bash
mkdir -p bundler/src bundler/demo bundler/demo/utils bundler/demo/folder
cd bundler
npm init --yes
touch src/index.js
cd demo 
touch index.js app.js utils/currentTime.js folder/something.js folder/something-else.js
npm init --yes
npm install lodash react react-dom
```

In our demo directory we'll add some code with require function calls to modules within the src directory and modules that have been installed from npm into the node_modules directory.

```js
// demo/index.js

const app = require('./app');
const partition = require('lodash/partition');

require('./folder/something.js');
app();

const currentTime = require('./utils/currentTime.js');
currentTime();

for (let i = 0; i < 10; i++) {
    require('./app')();
}

console.log(partition([1, 2, 3, 4], n => n % 2));
```

```js
// demo/app.js

const React = require('react');
const ReactDOM = require('react-dom');
const somethingElse = require('./folder/something-else.js');

const el = React.createElement('a', {
    href: 'hello'
}, 'This is a link');

console.log(ReactDOM.render(el, document.querySelector('#element')));

function helloWorld() {
    console.log('Hello World');
    console.log(somethingElse);
}

module.exports = helloWorld;
```

```js
// demo/utils/currentTime.js

module.exports = () => {
    console.log(`Date: ${new Date()}`);
}
```

```js
// demo/folder/something.js
function something() {
    console.log('something');
}

module.exports = something;
```

```js
// demo/folder/somthing-else.js
const something = require('./something.js');

module.exports = {
    hello: 'world'
}
```

### Creating the initial AST

In the src directory install **acorn** and require it in the index file along with the path and fs modules and create a function called `sourceToAST`, this will convert a source file to an AST. The function will have a source parameter and will call acorn's `parse` function, it will accept the source as an argument as well as an options object where we can specify the emca version. We'll also initialise an object variable named `MODULES` which will store a collection of all resolved modules.

```bash
npm install acorn
```

```js
const acorn = require('acorn');
const path = require('path');
const fs = require('fs');

const MODULES = {};

function sourceToAST(source) {
    return acorn.parse(source, {
        ecmaVersion: 2018
    });
}
```

Next create a bundler function that has parameters for an entry point and out file, we'll need to create variables for the root path, the initial module and the out file. We'll create these paths based on the current working directory by using the global process object. We'll also run the bundler initialisation and log out paths in the bundler to make sure everything look right.

```js
function bundler(entryPoint, out) {    
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;

    console.log(JSON.stringify({ ROOT_PATH, MODULE_PATH, OUT_PATH }, null, 2));
}

bundler('demo/index.js', `generated.js`);
```

We should see a nicely formatted object of all our paths with our variables as keys like so:

```bash
node src/index.js

{
  "ROOT_PATH": "/Users/dauser/Workspace/bundler/demo/",
  "MODULE_PATH": "/Users/dauser/Workspace/bundler/demo/index.js",
  "OUT_PATH": "/Users/dauser/Workspace/bundler/generated.js"
}
```

Next up we need to pass our initial module's source to the function that generates the AST and then we'll have our initial AST that we can start working with.
So lets remove the `console.log` call that we added earlier and instead read in the file and pass the source to the function.

```js
function bundler(entryPoint, out) {    
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;

    const init = fs.readFileSync(MODULE_PATH, 'UTF-8');
    const initialAST = sourceToAST(init);
}
```

We've now got our initial AST which we can traverse to find all the `require` function calls, we'll process these in order to bundle all the modules and we'll need to do this recursively for all modules that are resolved.

### Visiting nodes

Lets take a look at an AST in order to get a better idea of how it's structured and how we'll traverse it.
We can use https://astexplorer.net/ to see a visualisation of the the source as an AST, we can open and close the different nodes and view all the different properties that different nodes contain.

For supporting the common JS require call we will need to visit the **CallExpression** node, since this expression denotes when a function is called.
An example of this would be:

```js
const myModule = require('./my-module'); // this is a call expression
```

We'll take the simple example above and convert that to an AST with the AST Explorer:

```json
{
  "type": "Program",
  "start": 0,
  "end": 40,
  "body": [
    {
      "type": "VariableDeclaration",
      "start": 0,
      "end": 40,
      "declarations": [
        {
          "type": "VariableDeclarator",
          "start": 6,
          "end": 39,
          "id": {
            "type": "Identifier",
            "start": 6,
            "end": 14,
            "name": "myModule"
          },
          "init": {
            "type": "CallExpression",
            "start": 17,
            "end": 39,
            "callee": {
              "type": "Identifier",
              "start": 17,
              "end": 24,
              "name": "require"
            },
            "arguments": [
              {
                "type": "Literal",
                "start": 25,
                "end": 38,
                "value": "./my-module",
                "raw": "'./my-module'"
              }
            ]
          }
        }
      ],
      "kind": "const"
    }
  ],
  "sourceType": "module"
}
```

In the above source code we can see a few node types, the tree generated from acorn will start with a root node of type *Program* and a body property which is an array of nodes. Within the body property we'll see all the top level nodes and each of these nodes will have properties based on the types, these will be a mixture of other nodes or properties that are common in all node types. For example all nodes have the properties **type** (the node type), **start** (the starting character position in the source code) and **end** (the end character position source code). Any node with a block will have a body of new nodes for example an if statement or a for loop, these are in a new scope but you would need to manually track this if we needed to.

In the above example we can see that we start with a *VariableDeclaration* this contains a property named declarations which contains an array of declaration nodes. Each declaration node includes a number of properties including *id* which is a reference to the identifier and a *init* property which is the initialiser of the variable declaration, this is what the variable will initialise to. 
For example:

```js
const value = 1;
```

The id is *value* and the initialiser is the literal value *1*, to figure out what all the node types are we can look at the specification that acorn follows for creating an AST. Acorn follows the estree specification which can be viewed on github at:
https://github.com/estree/estree. There is a specification which matches each release of the Ecmascript specification, such as es5, es2015 etc that we can use to identify the different language constructs. 

Now we'll start visiting the nodes by traversing the tree, we'll be using the *estraverse* module in order to traverse the AST and visit nodes that we will need to transform, so to begin install and require estraverse.

```bash
npm install estraverse
```

```js
const estraverse = require('estraverse');
```

Next lets create a new function called *walkAndParse* which will walk all the nodes in the AST and allow you to check each node conditionally making operations on each.
The estraverse module uses the visitor pattern for this (https://en.wikipedia.org/wiki/Visitor_pattern), we can visit each node and conditionally perform an operation either when we enter or leave the node. We'll use the estraverse *replace* function as when we modify a node we want to replace it and we must return the node at the end of the function, replace will also allow us to remove nodes if we need to.
The basic operation that we'll be performing when walking each node is to look for the require function calls, we'll then need to resolve the module and parse that module along with adding it to our collection of resolved modules. For each module that is resolved from a source file we'd need to call *walkAndParse* again, making use of recursion and by the end process we should end up with all modules to be bundled together in our module collection.

When we visit a node we will be given a node object and can access the nodes properties, these properties can be found by viewing the estree specification.
We call `estraverse.replace` and pass the AST as the first argument and an object with an enter property which has a function as its value. The enter property is a callback function that is executed each time a node is entered, the node object will then be passed as the first argument and we can add an if statement to check that the type is a `CallExpression`.
https://github.com/estree/estree/blob/master/es5.md#callexpression

```js
function walkAndParse(ast, currentPath) {

    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                // start checking here
            }

            return node;
        }
    });

    return ast;
}
```

Then lets update the bundler to run the walkAndParse function:

```js
function bundler(entryPoint, out) {    
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;

    const init = fs.readFileSync(MODULE_PATH, 'UTF-8');
    const initialAST = sourceToAST(init);
    const parsedIntialAST = walkAndParse(initialAST, ROOT_PATH, resolver);
}
```

Once we've entered a node that is a call expression we want to check that the call expression callee type is an identifier, this tells us that a named function is being called.
We need to check this is a named function as you can also have a call expression node for an anonymous function which would not have an identifier as the callee and would instead have a FunctionExpression or ArrowFunctionExpression.
If it was a function expression then it could not be making a call to *require* as there would be no identifier to reference a defined function.
https://github.com/estree/estree/blob/master/es5.md#identifier

If the callee has no identifier for this node then we don’t attempt to parse it, the walker will still recursively visit its child nodes as there may be require call expressions further down that branch of the tree.

If we do find that the callee type is an identifier then we can check the identifier name and if this is *require*, then we now know we've visited a require function call. 
The final step it to check if the require call has been given any arguments, we need a single argument and we expect this to be a string literal.
Literals are static expressions within the source code, they are static values defined within the code and are not variable, it needs to be a literal as we need a static value for the module path.
For further information on literals you can visit the following:
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#Literals
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#String_literals

Update the `walkAndParse` function as follows:

```js
function walkAndParse(ast, currentPath) {

    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments.length === 1 && node.arguments[0].type === 'Literal') {
                    // attempt to resolve module here
                    console.log(node.arguments[0].value)
                }
            }

            return node;
        }
    });

    return ast;
}
```

We most likely also want to check in the above test that the literal value is also a string since integers and booleans are also literals, but we'll skip this for now. Now if we run the code again in the terminal using `node src/index.js` we should see the following:

```
./app
lodash/partition
./folder/something.js
./utils/currentTime.js
./app
```

### Resolving modules

Now that a require call expression with a literal expression argument has been identified, the module resolution needs to take place in order to find the correct full path to that module.
There are numerous paths that can be used when requiring a module and different cases for using each, below are the three main path types we'll support.

#### Absolute module path

```js
require('/Users/someuser/somemodule');
```

An absolute module path allows the require function call to reference any module on the file system, this is the simplest path to deal with as the full path has been defined for us. But this can also be brittle as it means your code is no longer portable, if it references a module on a particular users file system it may not be there for other users who want to bundle the project.

#### Relative module path

```js
require('./somemodule.js');
```

A relative module path allows the require call to look for a module that's relative to the current module, you can require in the current directory or move up directories using `..` for each directory you wish to move up. 
With the common JS pattern for requiring a module a file extension is not required, so for both relative and absolute paths we may need to add the extension during module resolution.

#### Node module path

```js
require('react');
```

A node module path allows require to resolve modules installed via npm/yarn etc, all of these modules reside within the node_modules directory. This is an extremely common pattern, of all the different resolution paths this is the most complex. 

When resolving a module such as the *react* example above, the module resolution will need to work differently. First of all we'd need to look within the node_modules directory, if you installed react now and looked in the node_modules directory you'd see a react directory but not a file called react. Where as will the other example you end up resolving a file this is not the case with the node module, so what exactly does the resolver look for in this instance?

When a node_module is installed the modules package.json is also installed, within this file there can be an optional reference to a *main* file which tells us what the initial file for the module should be and we can resolve that. Since this is optional the fallback for this is to look for a *index.js* file if there is no main property within the package.json, the index.js name is a reference to how web servers have default *index.html* files that are served for web requests.

Next there is the ability to require a file from the directory of an installed node module, for example if we were using lodash we can only require the methods we need.

```js
const partition = require('lodash/partition');
```

We're create the resolver in another file and export the class for use by the bundler, so create a file called *resolver.js* within the src directory.

In the code we export a resolver class that requires the root path, which we'll need whenever we want to resolve a module.
We're using the path module to help with path formatting and the fs module to retrieve information about the module that is being resolved.

The class has a single function called resolvePath which has two parameters `modulePath` and `currentPath`.
The `modulePath` parameter is the path module that is now being resolved, where as `currentPath` parameter is the path to module where the require function call had been made. 

Then we want to return an object with two properties `fullPath` and `newResolutionPath`. The fullPath property is the path we have resolved and the newResolutionPath property is the fullPath without the module name. The newResolutionPath property will then be used as the currentPath argument later on by the bundler if it finds any require calls in the module we have just resolved.

So lets add that:

```js
const fs = require('fs');
const path = require('path');

module.exports = class Resolver {
    constructor(rootPath) {
        this.rootPath = rootPath
    }

    resolvePath(modulePath, currentPath) {
        let fullPath;
        let newResolutionPath;
    
        return {
            fullPath,
            newResolutionPath
        }
    }
}
```

Next up we'll add the logic for all the different possible module paths, we'll use an if statement to test the different path types. 
Before we do that you may remember earlier that you don't have to include a file extension in the require function call, so we'll create a variable called `modulePathWithExtension` and use a ternary operator to conditionally append a `.js` extension if it's missing.

Now we check if the path module starts with `./` or `../` if it does then we expect its a relative path, set the `fullPath` to the current path with the module path from the require argument appended. Next we'll test if it starts with a `/` if it does then we expect its an absolute path and we just assign `fullPath` to `modulePathWithExtension`.

The node module resolution is a little more complex, the require function call could be targeting a directory or a file within a directory. Since the require function calls may not have a file extension we need to check if it's a directory or a file with a directory that is being required. If it's a directory then we must also try and load the package.json in order to check if a main entry point has been defined, if it has we use it and if it hasn't we default to `index.js`. Next similar to above we'll append a `.js` to the `nodeModulePath` as a variable called `nodeModulePathWithExtension` if it doesn’t have one and check if it's a valid file, if it is then assign `fullPath` to `nodeModulePathWithExtension`.

Finally the `newResolutionPath` is the same as the fullPath but without the directory name of the path, we can achieve this by calling the `path.dirname` function.


```js
resolvePath(modulePath, currentPath) {
    let fullPath;
    const modulePathWithExtension = modulePath.endsWith('.js') ? modulePath : `${modulePath}.js`;

    if ((modulePath.startsWith('./') || modulePath.startsWith('../'))) {
        fullPath = `${(currentPath)}${modulePathWithExtension}`;
    }
    else if (modulePath.startsWith('/')) {
        fullPath = modulePathWithExtension;
    } 
    else {
        const nodeModulePath = `${this.rootPath}node_modules/${modulePath}`;

        if (fs.existsSync(nodeModulePath) && fs.lstatSync(nodeModulePath).isDirectory()) {
            const main = JSON.parse(fs.readFileSync(`${nodeModulePath}/package.json`, 'UTF-8')).main || 'index.js';
            fullPath = `${nodeModulePath}/${main}`;
        }

        const nodeModulePathWithExtension = nodeModulePath.endsWith('.js') ? nodeModulePath : `${nodeModulePath}.js`;

        if (fs.existsSync(nodeModulePathWithExtension) && fs.lstatSync(nodeModulePathWithExtension).isFile()) {
            fullPath = nodeModulePathWithExtension;
        }
    }

    const newResolutionPath = `${path.dirname(fullPath)}/`;

    return {
        fullPath,
        newResolutionPath
    }
}
```

Now that we have created our resolver we need to a create a new instance of the resolver and pass this is to the `walkAndParse` function. Update the code as follows at the top require in the resolver:

```js
const Resolver = require('./resolver');
```

Next add the additional resolver argument to the `walkAndParse` function definition:

```js
function walkAndParse(ast, currentPath, resolver) {
```

Then update the bundler:

```js
const resolver = new Resolver(ROOT_PATH);
const parsedIntialAST = walkAndParse(initialAST, ROOT_PATH, resolver);
```

Update the `walkAndParse` function, removing the console log we added and replace with the following:

```js
const modulePath = node.arguments[0].value;
const { fullPath, newResolutionPath } = resolver.resolvePath(modulePath, currentPath);
```

Next we want to try and read in the resolved file path so that it can be bundled in to the generated file and so we can parse this resolved module for its common JS require calls.
We can achieve this by using the fs module to read in the file, we'll be doing this synchronously for brevity but it could be possible to chain these calls and do then asynchronously for improved performance.

Update the code after the resolvePath call to add in:

```js
const resolved = fs.readFileSync(fullPath, 'UTF-8');
```

Now that we have loaded in a new module source file we need to be able to make sure any code that has been exported in the source file is returned and be used by the require call or anything the require call is assigned to.  

// maybe we'll remove this bit
One edge case we may see here is if the resolved path returned is undefined a reason for this may be it a native node module such as `stream` has been required. In these cases you could fall back to using one of the browser based implementations such as https://github.com/webpack/node-libs-browser.

### Wrapping and recursively parsing

If we look at our `index.js` file we can see that the first require call is in reference to `app.js`, the `app.js` file exports a function called `helloWorld` and in the `index.js` file this is assigned to the constant variable `app` within `index.js`. 

```js
// index.js
const app = require('./app');
```

```js
// app.js
function helloWorld() {
    console.log('Hello World');
    console.log(somethingElse);
}

module.exports = helloWorld;
```

We would therefore expect once the files are bundled into a single generated file that we would be able to execute the `app` variable and this would execute a reference to the `helloWorld` function. The common JS specification mentions we should be able to references any values exported with both `module.exports` and `exports` and both those should be able to export any primitive data type. Finally we want to make sure that everything within each modules scope remains within its scope and does not leak in to the global scope of the file. 

In order to achieve this we can borrow from the NodeJS implementation of requiring modules, when a module is requires is it  wrapped in a function with a number of arguments such as exports, module and __dirname. For more information you can check out https://nodejs.org/api/modules.html.

In our implementation we will wrap each of our source files in a function that is assigned to a value of require_HASH_ID where HASH_ID is an md5 hash of the source file. On top of this we need to create an initial `module` variable that references an object with an `exports` object property and and `exports` property which references the `module.exports` value, we also need to return the `module.exports`. Finally we can then replace the original call expression's node name with this require_HASH_ID value and the reference to the required files source will be completed.

The template for this wrapped source can be added to our index.js file as a function with a `source` parameter as the following:

```js
function commonJSWrapperTemplate(id, source) {
    return `const require_${id} = (function() { 
        const module = { exports: {}};
        const exports = module.exports;
    
        ${source}
        
        return module.exports;
    });`;
}
```

Now that we have our common JS wrapper template we can go back to our CallExpression visitor to wrap the source code and continue the recursive search for more require call expressions that need to be resolved, wrapped and bundled. Lets update the visitor so that we create the hash id, create a module object that references the current AST node, paths, id and the resolved module source. We will also add a reference to a property called exports, which will invoke a function called `wrapSourceAndParse`. The `wrapSourceAndParse` function will wrap the resolved module in the common JS wrapper, convert the source into an AST and then call `walkAndParse` on this AST. The `walkAndParse` function will return the AST as the end of the function so this will then be assigned to the `exports` property of the `module` object we have created. 

Next we'll rename the CallExpression from `require` to require_HASH_ID as mentioned earlier and we will push the `module` object we've created in to a global `MODULES` object that we'll define at the top of our bundler. Later on we will iterate over the `MODULES` object to generate our final bundle. Firstly we need to install the md5 library for creating our hash and require it at the top of our bundler:

```bash
npm install md5
```

```js
const md5 = require('md5');
```

Next update the `walkAndParse` function within the if statement as follows:

```js
const modulePath = node.arguments[0].value;
const { fullPath, newResolutionPath } = resolver.resolvePath(modulePath, currentPath);
const resolved = fs.readFileSync(fullPath, 'UTF-8');
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
```

Next add the new function `wrapSourceAndParse`.

```js
function wrapSourceAndParse(resolvedSource, currentPath, id, resolver) {
    const wrappedSource = commonJSWrapperTemplate(id, resolvedSource);
    const resolvedAST = sourceToAST(wrappedSource);
    return walkAndParse(resolvedAST, currentPath, resolver);
}
```

Now that we are able to resolve all our modules from our initial file and create a set of parsed AST we want to be able to generate our new bundled code, which we'll do in the next section.

### Code generation

We've done quite a lot of processing lets actually generate something from all our hard word, the generated code is actually going to fail to execute which we will shortly see, sorry about that. But we'll have *something* that is generated and we can stick a small hack in to see the fruits of our labour and then go and immediately fix it afterwards.

Generating the final code output is surprisingly easy we'll make use of a module called escodegen which stands for ECMAscript Code Generator, this module allows you to pass in an estree compatible AST and will output source code from the AST. We will iterate over the resolved modules we have in the `MODULE` object to generate their output code, then we'll generate the initial module code. Finally we'll wrap the whole thing in an immediately invoked function execution (IIFE) so that we keep everything in our bundle out of the global scope and don't accidentally pollute any other code in the global scope and make any other code in the global scope does not pollute our code. 

First install escodegen in the root directory and require it at the top of the index.js file:

```bash
npm install escodegen
```

```js
const escodegen = require('escodegen');
```

Next we'll update our bundler function, we'll add a call to a function called `generateCode` which takes our `parsedIntialAST` and `MODULES` object. Then an `iifeTemplate` function which takes the resultant code of `parsedIntialAST` call and finally we'll write out the result with the `fs` module to the path defined at `OUT_PATH`.

```js
function bundler(entryPoint, out) {
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;
    const init = fs.readFileSync(MODULE_PATH, 'UTF-8');
    const initialAST = sourceToAST(init);
    const resolver = new Resolver(ROOT_PATH);
    const parsedIntialAST = walkAndParse(initialAST, ROOT_PATH, resolver);
    const output = generateCode(parsedIntialAST, MODULES);
    const result = iifeTemplate(output);

    fs.writeFileSync(OUT_PATH, result, 'UTF-8');
}
```

Next up we'll create the `generateCode` function, as mentioned earlier this will iterate over the ASTs to generate our output file.
We'll iterate over the modules using `Object.values` to generate an array of values, then using map we'll create an array of generated source code with the exports value of module. Then we'll create a single string by using join, finally we need to convert the `init` file back to source and we'll join all code using using a multiline string with the init file going last.

```js
function generateCode(init, modules) {
    const generatedCode = Object.values(modules).map(value => escodegen.generate(value.exports)).join('\n');
    const initialiser = escodegen.generate(init);
    return `${generatedCode}\n${initialiser}`;
}
```

Now that we've created our generated output file we want to wrap it in the IIFE we mentioned earlier, we'll create a template function like we did with the common JS wrapper.

```js
function iifeTemplate(output) {
    return `(function() {${output}}())`;
}
```

Now from the terminal we should be able to run the bundler with the following command:

```bash
node src/index.js
```

If everything goes to plan we should see a generated JS file in the root of our directory.
Lets create a little demo html page to test our bundle, create a new file in the root out of directory and add the following.

```html
<div id="element"></div>
<script src="./generated.js"></script>
```

Now if we try and visit this page we'll see that no react element has actually been rendered, if we check the console we should see an error with the following stack trace.

```js
Uncaught ReferenceError: process is not defined
    at require_3c705474d87ac8a9b47623a9c3833989 (generated.js:1528)
    at require_785ce0fa348dcb9b9692a0ce512f61fe (generated.js:20858)
    at generated.js:22699
    at generated.js:22713
```

This is kinda weird, the reason for this is that many modules have a development and production build and will use current process to try and only bundle the correct version. Different bundlers such as webpack and rollup support the ability to conditionally require modules based on the current `NODE_ENV` defined as an environment variable at bundle time. Lets take react for an example if we look at the index file we can see the following: 

```js
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react.production.min.js');
} else {
  module.exports = require('./cjs/react.development.js');
}
```

At bundle time the bundler will look for a pre-compiled versions of react which is either a development or production flavour based on the `NODE_ENV` value in the defined environment variables. 

Lets add a quick hack to get our generated code to run then we can implement conditional bundling afterwards. Update the `iifeTemplate` to add a process object at the top most scope of the generate file which contains a `env` object with `NODE_ENV` property set to `development`.

```js
function iifeTemplate(source) {
    return `(function() {const process = {env: { NODE_ENV: 'development' }};${source}}())`;
}
```

Now if we reload the testing page we created we should see that the react code has run and rendered a link and we should see a bunch of console logs with the output of our exported modules and function executions in the developer console. Our bundler works! Lets revert the change and look in to implementing the conditional bundling functionality.

### Conditional bundling with NODE_ENV

In order to support conditional bundling we will need to traverse each AST and process any if statements, looking for references to `process.env.NODE_ENV` and statically determine if the test within the if statement evaluates to true or false. In order to figure out what kinds of node properties we will need to work with we can again look at the specification of the estree nodes https://github.com/estree/estree/blob/master/es5.md#ifstatement. From this we can determine there will be test node where the if statements test exists, a consequent block statement node containing some code to be executed and an optional alternate statement which could be a block statement or another if statement. For our implementation we will check for an alternate statement but only support the block statement and not continually try to process any `else if ()` statements. 

Starting with the test node we need to check if it is a **BinaryExpression**, for example `1 == 1` is a binary expression and if this is the case it should have a left, right and operator node which we can evaluate. 

Next we want to find a **MemberExpression** on either the left or right sides of the binary expression test, a member expression means we're trying to access the property (the member) of an object. There are different ways of accessing object properties for example using dot notation e.g `object.property` or square bracket access eg `object['property']`. Viewing the estree specification https://github.com/estree/estree/blob/master/es5.md#memberexpression we can see there are `object` and `property` values and we can use these to determine if the test is checking `process.env.NODE_ENV`. The `object` value refers to the object that is being accessed and the `property` is referencing the property within that object, which on the surface is quite straightforward. The order in which the these values are evaluated is a little confusing, when accessing a property that is two levels deep there will be nested member expressions. The nesting works from right to left so the top level member expression will in fact have `property` referenced to the final property referenced and recursing the `object` values will work backwards to the starting object. For example with `process.env.NODE_ENV` the node would look like:

```json
"expression": {
    "type": "MemberExpression",
    "start": 0,
    "end": 20,
    "object": {
        "type": "MemberExpression",
        "start": 0,
        "end": 11,
        "object": {
            "type": "Identifier",
            "start": 0,
            "end": 7,
            "name": "process"
        },
        "property": {
            "type": "Identifier",
            "start": 8,
            "end": 11,
            "name": "env"
        },
        "computed": false
    },
    "property": {
        "type": "Identifier",
        "start": 12,
        "end": 20,
        "name": "NODE_ENV"
    },
    "computed": false
}
```

As you can see from the the JSON representation of the node, the first property value is `NODE_ENV` not `process`, the `process` reference is in fact within the next MemberExpression node which is within the object value. Lets put all these checks together as code so we end up with some functionality that can determine if we has a test within an if statement that is evaluating the `NODE_ENV` environment variable against a literal value and add it to the `walkAndParse` function. After the `if (node.type === 'CallExpression') {...}` block add the following: 

```js
if (node.type === 'IfStatement') {
    // This allows us to generate different bundles based on the NODE_ENV value, allowing development and production builds
    // needs to be a binary expression
    if (node.test.type !== 'BinaryExpression') return;
    // check if either left or right are member expressions that look for the node env
    // check if either the left or right string literal, if it is lets build and compare the two
    const { left, right, operator } = node.test;

    if ((left.type === 'MemberExpression' || right.type === 'MemberExpression') && (left.type === 'Literal' || right.type === 'Literal')) {
        // the member expression and literal can be on either side of the test so figure that out and assign to variables
        const member = right.type === 'MemberExpression' ? right : left;
        const literal = right.type === 'Literal' ? right : left;

        // figure out if the member expression is actually referencing process.env.NODE_ENV if not return early
        if (member.object.type !== 'MemberExpression' || member.object.object === undefined || member.object.object.name !== 'process') return;
        if (member.object.property.name !== 'env' && member.property.name !== 'NODE_ENV') return;

        // evaluate test here
    }
}
```

In the code above there is some annotations for each code comments as it gets a little complicated, we check if it's a BinaryExpression, we then check the test values are MemberExpression and a Literal. Then we check the MemberExpression is referencing the current process's environment variable and looking at the `NODE_ENV` environment variable. If we get this far without returning then we want to run the if statements test, given that we don’t actually have the source code at this point we need to reconstruct the if statements test and invoke it. We can achieve this using the Function class https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function to create a function at runtime that constructs a function that will evaluate and return the value of the test, we can then run it and assign it to a variable to check. After the NODE_ENV check add the following:

```js
const { value } = literal;
const result = new Function(`return "${value}" ${operator} "${process.env.NODE_ENV}"`)();
```

Now that we have a result we want to replace the entire if statement with the block of code that should be there for example assuming that NODE_ENV was development we would expect the following:

```js
// from this
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react.production.min.js');
} else {
  module.exports = require('./cjs/react.development.js');
}

// to this 
{
  module.exports = require('./cjs/react.development.js');
}
```

We also want to keep the curly braces (BlockStatement) around the unit of code in order to maintain the scope, since every block of code within curly braces has its own lexical scope.
So to complete the functionality we are looking for we want to check the result of the test, if it evaluates to true we want to keep the consequent BlockStatement. If the test is false and there is an alternate BlockStatement then we want to keep this BlockStatement and if there is no alternate then we remove the entire node.

```js
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
```

We're now ready to run our bundler again, we need to set a `NODE_ENV` environment variable since right now we don’t fallback to a default value. So run the following code:

```bash
NODE_ENV='development' node src/index.js
```

Now if you open the html file we create earlier you should see the react component being rendered along with the multiple console logs. If you have the react dev tools extension you should also see *This page is using the development build of React.* when clicking on the icon. 

Now lets try bundling the production version with the following command:

```bash
NODE_ENV='production' node src/index.js
```

We should still see the same functionality as previously but clicking on the react dev tools icon should now give us *This page is using the production build of React.*, you should also see a reduction of several hundred kilobytes in the bundle size. For bonus points you could also minify when in production mode to further reduce your bundle size.

And that's our bundler working, there's loads of improvements that can be made so feel free to try and implement some these include:

- encapsulating the bundler in to a class
- using a graph data structure for tracking the dependencies
- code splitting
- esmodule support
- replacing synchronous calls modules can be parsed in parallel

Some References:

https://www.ecma-international.org/ecma-262/
https://nodejs.org/docs/latest/api/modules.html#modules_the_module_object
https://github.com/webpack/docs/wiki/commonjs
https://stackoverflow.com/questions/16383795/difference-between-module-exports-and-exports-in-the-commonjs-module-system
