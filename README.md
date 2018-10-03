# Building a Javascript module bunder

## Introduction

*Source*: https://github.com/jackpopp/bundler/blob/master/src/index.js

A Javascript bundler is essentially a source to source compiler otherwise known as a transpiler. It takes Javascript source code, transforms it in someway and then outputs a different form of the source code. In our case we're taking the individual Javascript source files and bundling them together, rewriting specific pieces of code such as the require calls. Most bundlers will build a dependecy graph using a graph data structure (https://en.wikipedia.org/wiki/Dependency_graph), which can be used for generating the JS bundle, visualisation and code spliting. In this bundler we will forgo a fully directed dependency graph for brevity, we will also resolves modules syncronously which will be slower but allow for simpler code.

### TL:DR
The basic steps for bundling our modules are as follow:

- Transform inital source code to AST
- Traverse AST and detect require function calls
- Resolve module by processing call expressions with a callee named require
- Wrap resolved module in common JS helper function
- For each resolved module, generate an AST and recursively trasverse the AST
- Add each modified AST to a module graph
- Iterate over the ASTs converting to code using escodegen
- Wrap in an immediately invoked function expression
- Write bundle to file

The bundler begins by reading the entry point JS file file and converting this to an Abstract Syntax Tree (AST) following the ecmascript 2018 specification (https://www.ecma-international.org/ecma-262/9.0/index.html#Title). 
An AST is a tree representation of the source code with each node representing a construct in the language.
To parse the inital source file to an AST we can use the Acorn, the resultant AST follows the estree implemention of the 2018 spec which can be found here (https://github.com/estree/estree).
Using the specification we can figure out which nodes we want to look for and modify in order to bundle all our code together.
We'll take the AST and we'll use estraverse to travservse the nodes, visiting each node checking the type then modifying, replacing or removing.
This will need to happend recursively for all common JS require function calls that we fine.

### Initial Set up

Create a directory called bundler for all our source code, in here add an src directory for the bundler source and demo directory for our demo project.
Initalise a package.json in the root folder and the demo folder, we'll need a package.json in the demo directory to test bundling node modules.

```bash
mkdir -p bundle/src bundle/demo bundle/demo/utils
cd bundle
npm init --yes
touch src/index.js
cd demo 
touch index.js app.js utils/currentTime.js
npm init --yes
```

In our demo directory we'll add some require function calls to modules within the src directory and modules that installed from npm to the node_modules directory.

```javascript
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

```javascript
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

```javascript
// demo/utils/currentTime.js

module.exports = () => {
    console.log(`Date: ${new Date()}`);
}
```

```javascript
// demo/folder/somthing.js
function something() {
    console.log('something');
}

module.exports = something;
```

```javascript
// demo/folder/somthing-else.js
const something = require('./something.js');

module.exports = {
    hello: 'world'
}
```

### Creating the inital AST

In the src directory install **acorn** and require it in the index file along with the path module, create a function that converts a source file to an AST.

```bash
npm install acorn
```

```javascript
const acorn = require('acorn');
const path = require('path');

function sourceToAST(source) {
    return acorn.parse(source, {
        ecmaVersion: 2018
    });
}
```

Next create a bundler function that accepts arguments for an entry point and out file, we'll need to create variables for the root path, the inital module and the out file. We'll created these paths based on the current working directory by using the global process object. We'll also run the bundler initalisation and log out paths in the bundler to make sure everything look right.

```javascript
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

Next up we need to pass our inital modules source to the function that generates the AST and we'll have our inital AST that we can start working with.
So lets remove the `console.log` call that we added earlier and instead read in the file and pass the source to the function.

```javascript
function bundler(entryPoint, out) {    
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;

    const init = fs.readFileSync(MODULE_PATH, 'UTF-8');
    const initalAST = sourceToAST(init);
}
```

We've now got our inital AST which we can traverse it to find all the `require` function calls, we'll process these in order to bundle all the modules and we'll need to do this recruively for all modules that are resolved.

### Visiting nodes

Lets take a look at the AST in order to get a better idea of how its structured and how we'll traverse it.
We can use https://astexplorer.net/ to see a visualisation of the the source as an AST, we can open and close the different nodes and view all the different properties that different nodes contain.

For supporting the common JS require hook we will need to visit the **CallExpression** node, since this expression denotes when a function is called.
An example of this would be:

```javascript
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

In the above source code we can see a few node types, the tree generated from acorn will start with a root we start with a root node of type *Program* and a body property of type array. Within the body property we'll see all the top level nodes and each of these nodes will properties based on the types and these will be a mixture of other nodes or properties shared amongst all nodes. For example all nodes have a type (the node type), start (the starting character position) and end (the end character position). Any node with a block will have a body of new nodes and these are a new scope.

In the above example we can see that we start with a *VariableDeclaration* this contains an array of declartions including *id* which is a reference to the identifier and a *init* property which is the initaliser of the variable declaration, this is basically what the variable will initalise to. 
For example:

```
const value = 1;
```

The id is *value* and the initaliser is the literal value *1*, to figure out what all the node types are we can look at the specification that acorn follows for creating an AST. Acorn follows the estree specification which can be viewed on github at:
https://github.com/estree/estree

There is a specification which matches each release of the Ecmascript specificaion, such as es5, es2015 etc.
We'll be using the *estraverse* module in order to traverse the AST and visit nodes that we will need to transform, so to begin install and require estraverse.

```bash
npm install estraverse
```

```javascript
const estraverse = require('estraverse');
```

Next lets create a new function called *walkAndParse*, which will visit all the nodes in the AST and allow you to check each, conditionally making operations on each.
This is called the visitor pattern - url here, we can visit each node do an operation either when we enter or leave the node, with the estraverse *replace* function we must return the node at the end of the function.
The basic operation that we will be doing by walking each node is to look for the require calls, we'll then need to resolve the module and parse that module along with adding it to our list of modules. For each moduel that is resvoled from a source file we'd need to resurively call *walkAndParse* again, by the end process we should end up with a dependcy graph of all modules that can be bundled together.

When we visit this node we will be given the node object along with its properties, these properties can be found by viewing the estree specification.
https://github.com/estree/estree/blob/master/es5.md#callexpression

```javascript
function walkAndParse(ast, currentPath) {

    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                // start checking here
            }

            return node;
        }
    }
}
```

First we want to check that the call expression callee type is an identifier, the identifier is the name of the function that is being called
We need to check this is that you can have call expressions for an anonymous function which has no idientifier and instead would have a function expression.
If it was a function expression then it could not be making a call to *require*.
https://github.com/estree/estree/blob/master/es5.md#identifier

If the callee has no identifier for this node then we dont attempt to parse it, the walker will still visit its child nodes as there may be require call expressions further down that branch.

If we do find that the callee has an identifier then we can check the identifer name and if this is *require*, then we now know we've hit an require call. 
The final step it to check if the require call has been given any arguments, we need a single argument and we exprect this to be a string literal.
Literals are static expressions within the source code, they are static values defined within the code and are not variable.
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#Literals
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#String_literals

```javascript
function walkAndParse(ast, currentPath) {

    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] && node.arguments[0] && node.arguments[0].type === 'Literal') {
                    // attemp to resolve module here
                }
            }

            return node;
        }
    }
}
```

We most likely also want to check in the above test that the literal value is also a string since intergers and booleans are also literals, but we'll skip this for now.

### Resolving modules

Now that a require call expression with a literal expression has been identified, the module resolution needs to take place in order to find the correct path to the module.
There are numerous ways that a module call be resolved using require and a some different cases for each, below are the three main ways we can resolve modules.

#### Absolute module path

```
require('/Users/dauser/somemodule');
```

An absolute module path allows the require call to reference any module on the file system, the module bundler wont be implementing this type of path resolution. The reason for this being that most published modules will not make references to absolute paths and in general a developer will not make use of absolut paths.

#### Relative module path

```
require('./somemodule.js');
```

A relative module path allows the require call to look for a module that's relative to the current module, you look in the current directory or move up directories using `..` for each directory you wsh to move up.
With both absolute and relative module paths following the node commonjs pattern a file extention is not required, so this needs to be added as required during module resolution.

#### Node module path

```
require('react');
```

A node module path allows require to resolve modules installed via npm/yarn et all and reside within the node_module folders. This is an extremely common pattern which has a few caveats, of the different resolution paths this is the most complex. 

When resolving a module such as the *react* example above we're using an identifier to the installed directory name within the node module, so within node_modules you will see a directory called react. If you look within the directory there is no file called react, so what exactly is going to be resolved? 

When a node_module is installed the modules package.json is also installed, within this file there can be an optional reference to a *main* file which tells us what the inital file for the module should be. Since this is optional the fallback for this is to look for a *index.js* file if there is no main property within the package.json, the index.js name is a refernce to how webservers have default *index.html* files that are served for web requests.

Next there is the ability to require a file from the directory of an installed node module, for example if we were using lodash we can only require the methods we need

```
const partition = require('lodash/partition');
```

We're create the resolver in another file and export the class for use by the bundler, so create a file called *resolver.js*.

In the code we export a resolver class that requires the root path, which we'll need whenever we want to resolve a node module.
We're using the path module to help with path formatting and the fs module to retrieve information about the module that is being resolved.

The class has a single function called resolvePath which has two parameters `modulePath` and `currentPath`.
Module path is the path module that is now being resolved, where as currentPath is the path to module where the require call has been made. 

Then we want to return an object with two properties `fullPath` and `newResolutionPath`. The fullPath property is the path we have resolved and the newResolutionPath property is the fullPath without the module name. The newResolutionPath property will then be used as the currentPath arguement later on by the bundler if it finds any require calls in the module we have just resolved.

So lets add that:

```javascript
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

Next up we'll add the logic for all the different possible module paths, we'll use an if statement to test if the path is relative otherwise assume its a node module.
First we check if there module starts with `./` or `../` if it does then we expect its a relative path, set the `fullPath` to the current path with the module path from the require argument appended.

The node module resolution is a little more complex, the require call could be targeting a directory or a file within a directory. Since the require statements do not mandate a file extension we need to check if it's a directory or a file that is being referenced. If it's a directory then we must also try and load the package.json in order to check if a main entry point has been defined, if it has we use it and if it hasnt we default to `index.js`. Next we'll append a `.js` to the `modulePath` as a variable called `nodeModulePathWithExtension` if it doesnt have one and check if it's a valid file, if it is then assign `fullPath` to `nodeModulePathWithExtension`.

Finally the `newResolutionPath` is the same as the fullPath but without the directory name of the path, we can achieve this using `path.dirname`.


```javascript
resolvePath(modulePath, currentPath) {
        let fullPath;

        if ((modulePath.startsWith('./') || modulePath.startsWith('../'))) {
            const nodeModulePathWithExtension = modulePath.endsWith('.js') ? modulePath : `${modulePath}.js`;
            fullPath = `${(currentPath)}${modulePath}`;
        } else {
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

Now that we have created our resolver we need to a create a new instance of the resolver and pass this is to the `walkAndParse` function.
Update the bundler as follows:

```javascript
const resolver = new Resolver(ROOT_PATH);
const parsedIntialAST = walkAndParse(initalAST, ROOT_PATH, resolver);
```

Then update the `walkAndParse` function:

```javascript
function walkAndParse(ast, currentPath, resolver) {
    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] && node.arguments[0] && node.arguments[0].type === 'Literal') {
                    const modulePath = node.arguments[0].value;
                    const { fullPath, newResolutionPath } = resolver.resolvePath(modulePath, currentPath);
```

Next we want to try and read in the resolved file path so that it can be bundled in the generated file and so we can parse this resolved module for its common JS require calls.
We can achieve this by using the fs module to read in the file, we'll be doing this syncronuously for brevity but it could be possible to chain these calls and do then asyncrounously for improved performance.

Update the code after the resolvePath call to add in:

```javascript
let resolved = fs.readFileSync(fullPath, 'UTF-8');
```

Now that we have loaded in a new module source file we need to be able to make sure any code that has been exported in the source file is returned and be used by the require call or anything the require call is assigned to.  

// maybe we'll remove this bit
One edge case we may see here is if the resolved path returned is undefined a reason for this may be it a native node module such as `stream` has been required. In these cases you could
fall back to using one of the browser based implementations such as https://github.com/webpack/node-libs-browser, for now in our cases with front end based projects we wont run in to these problems.

### Wrapping and recursively parsing

If we look at our `index.js` file we can see that the first require call is in reference to `app.js`, the `app.js` file exports a function called `helloWorld` and in the `index.js` file this is assigned to the constant variable `app` within `index.js`. 

```javascript
// index.js
const app = require('./app');
```

```javascript
// app.js
function helloWorld() {
    console.log('Hello World');
    console.log(somethingElse);
}

module.exports = helloWorld;
```

We would therefore expect once the files are bunlded into a single generated file that we would be able to execute the `app` variable and this would execute a reference to the `helloWorld` function. As the common JS specification mentions we should be able to references any values exported with both `module.exports` and `exports` and both those should be able to export any primitive data type. Finally we want to make sure that everything within each modules scope remains within its scope and does not leak in to the global scope of the file. 

In order to achieve this we can borrow from the NodeJS implementation of requiring modules, when a module is requires is it  wrapped in a function with a number of arguments such as exports, module and __dirname. For more information you can check out https://nodejs.org/api/modules.html.

In our implementation we will wrap each of our source files in a function that is assigned to a value of require_HASH_ID where HASH_ID is an md5 has of the source file. On top of this we need to create an inital `module` variable that references an object with an `exports` object property and and `exports` property which references the `module.exports` value, we also need to return the `module.exports`. Finally we can then replace the original call expression's node name with this require_HASH_ID value and the reference to the required files source will be completed.

The template for this wrapped source can be added to our index.js file as a function with a `source` parameter like the following:

```javascript
function commonJSWrapperTemplate(id, source) {
    return `const require_${id} = (function() { 
        const module = { exports: {}};
        const exports = module.exports;
    
        ${source}
        
        return module.exports;
    });`;
}
```

Now that we have our common JS wrapper template we can go back to our CallExpression visitor to wrap the source code and continue the recursive search for more require call expressions that need to be resolved, wrapped and bundled. Lets update the vistor so that we create the hash id, create a module object that references the current AST node, paths, id and the resolved module source. We will also add a reference to a property called exports, which will invoke a function called `wrapSourceAndParse`. The `wrapSourceAndParse` function will wrap the resolved module in the common JS wrapper, convert the source into an AST and then call `walkAndParse` on this AST. The `walkAndParse` function will return the AST as the end of the function so this will then be assigned to the `exports` propertly of the `module` object we have created. 

Next we'll rename the CallExpression from `require` to require_HASH_ID as mentioned earlier and we will push the `module` object we've created in to a global `MODULES` object that we'll define at the top of our bundler. Later on we will interate over the `MODULES` object to generate our final bundle.

```javascript
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
```

Now that we are able to resolve all our modules from our inital file and create a set of parsed AST we want to be able to generate our new bundled code, which we'll do in the next section.

### Code generation

Now that we've done quite a lot of processing lets actually generate something from all our hard word, the generated code is actually going to fail to execute which we will shortly see. But we'll have *something* that is generated from all our hard work and we'll stick a hack in to see the fruits of our labour and then go and imiediately fix it afterwards in the *Conditional bundling with NODE_ENV*. 

Generating the final code output is surpisingly easy we'll make use of a module called escodegen which stands for Ecma Script Code Generation, this module allows you to pass in an ESTREE compatible AST and will output source code from the AST. We will iterate over the resolved modules we have in the `MODULE` object, next we'll generate the initaliser code. Finally we'll wrap the whole thing in an imediately invoked function execution (IIFE) so that we keep everything in our bundle out of the global scope and dont accidentally pollute any other code in the global scope and make any other code in the global scope does not pollute our code. 
Firstly we'll update our bundler function, we'll add a call to a function called generate code which takes our `parsedIntialAST` and `MODULES` object. Then an `iifeTemplate` function which takes the resultant code of `parsedIntialAST` call and finally we'll write out the result with the `fs` module to the path defined at `OUT_PATH`.

```javascript
function bundler(entryPoint, out) {
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;
    const init = fs.readFileSync(MODULE_PATH, 'UTF-8');
    const initalAST = sourceToAST(init);
    const resolver = new Resolver(ROOT_PATH);
    const parsedIntialAST = walkAndParse(initalAST, ROOT_PATH, resolver);
    const code = generateCode(parsedIntialAST, MODULES);
    const result = iifeTemplate(code);

    fs.writeFileSync(OUT_PATH, result, 'UTF-8');
}
```

Next up we'll create the `generateCode` function, as mentioned earlier this will iterate over the ASTs to generate our output file.
We'll iterate over the modules using `Object.values` to generate an array of values, then using map we'll create an array of generated source code with the exports value of module. Then we'll create a single string by using join, finally we need to convert the `init` file back to source and we'll join all code using using a multiline string with the init file going last.

```javascript
function generateCode(init, modules) {
    let generatedCode = Object.values(modules).map(value => escodegen.generate(value.exports)).join('\n');
    let initaliser = escodegen.generate(init);
    return `${generatedCode}\n${initaliser}`;
}
```

Now that we've generated our generated source file we want to wrap it in the IIFE we mentioned earlier, we'll create a template function like we did with the common JS wrapper.

```javascript
function iifeTemplate(source) {
    return `(function() {${source}}())`;
}
```

We've now got our working bundler the final thing to do is invoke the bundler, so lets add a call to the bundler with our entry point and out path at the end of the index file.

```javascript
bundler('demo/index.js', `generated.js`);
```

Now from the terminal we should be able to run the bundler with the following command:

```bash
node src/index.js
```

If everything goes to plan we should not see any errors and we should see a generated JS file in the root of our directory.
Lets create a little demo html page to test our bundle, create a new file and add the following.

```html
<div id="element"></div>
<script src="./generated.js"></script>
```

Now if we try and visit this page we'll see that no react element has actually been renderered, if we check the console we'll see the following error.

```javascript
Uncaught ReferenceError: process is not defined
```

This is kinda weird, the reason for this is that many modules have a developement and production build and will use current process to try and only bundle the correct version. Different bundlers such as webpack and rollup support the ability to conditionally require modules based on the current `NODE_ENV` defined as an environment variable at bundle time. Lets take react for an example if we look at the index file we can see the following: 

```javascript
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react.production.min.js');
} else {
  module.exports = require('./cjs/react.development.js');
}
```

At bundle time the bundler will look for a pre-compiled versions of react which is either a development or production flavour based on the `NODE_ENV` value in the defined environment variables. 

Lets add a quick hack to see our generated code to run then we can implement conditional bundling in the next section. Update the `iifeTemplate` to add a process object at the top most scope of the generate file which contains a `env` object with `NODE_ENV` property set to `development`.

```javascript
function iifeTemplate(source) {
    return `(function() {const process = {env: { NODE_ENV: 'development' }};${source}}())`;
}
```

How if we reload the the testing page we created we should see that the react code had run and rendered a link and we should see a bunch of console logs with the output of our exported modules and function executions. Now that we can see that our bundle works as expected lets revert the change and look in to implementing the conditional bundling functionality.

### Conditional bundling with NODE_ENV

In order to support conditional bundling we will need to traverse each AST and process any if statements looking for references to `process.env.NODE_ENV` and statically determine if the test within the if statement evaluates to true or false. In order to figure out what kinds of node properties we will need to work with we can again look at the specification of the estree nodes https://github.com/estree/estree/blob/master/es5.md#ifstatement. From this we can determine there will be test node where the if statements test exists, a consequent block statement node containing some code to be executed and an optional alternate statement which could be an block statement or another if statement. For our implementation we will check for an alternate statement but only support the block statement. 

Starting with the test node we need to check if it is a binary expression for example `1 == 1` is a binary expression, if this is the case it should have a left, right and operator node which we can evaluate. 

// this bit seems a bit confusing maybe needs some editing

Next we want to find a member expression on either sides of the test this is node that represents accessing object properties using dot notation eg `myproperty.propery` or square bracket access eg `myproperty['property']`. Viewing the estree specification https://github.com/estree/estree/blob/master/es5.md#memberexpression we can see there are `object` and `property` values and we can use these to determine if the test is checking `process.env.NODE_ENV`. The `object` value refers to the object that is being accessed and the `property` is referencing the property within that object, which on the surface is quite straightforward. The order in which the these values are evaluated is a little confusing, when accessing a propery that is two levels deep there will be nested member expressions. The nesting works from right to left so the top level member expression will in fact have `property` referenced to the final property referenced and recursing the `object` values will work backwards to the starting object. For example with `process.env.NODE_ENV` the node would look like:

```
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

As you can see from the the JSON representation of the node, the first property value is `NODE_ENV` not `process`, the `process` reference is in fact within the next MemberExpression node which is within the object value. Lets put all these checks together as code so we end up with some functionality that can determine if we has a test within an if statement that is evaluating the `NODE_ENV` environment variable against a literal value.

```javascript
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

        // evaluate test here
    }
}
```

In the code above there is some annoations for each section, we check if its a BinaryExpression, we check the test values are MemberExpression and Literal. Then we check the MemberExpression is referencing the current processes' envionrment variables and looking at the `NODE_ENV` envrinonment variables. If we get this far without returning then we want to run the if statements test, given that we dont actually have the source code at this point we need to reconstruct the if statements test and invoke it. We can achieve this using the Function class https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function to create a function at runtime that constructs a function that will evaluate and return the value of the test, we can then run it and assign it to a variable to check. After the NODE_ENV check add the following:

```javascript
const { value } = literal;
const result = new Function(`return "${value}" ${operator} "${process.env.NODE_ENV}"`)();
```

Now that we have a result we want to replace the entire if statement with the block of code that should be there for example assuming that NODE_ENV was developement we would expect the following:

```
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

We also want to keep the curly braces (a BlockStatement) around the unit of code in order to maintain the scope, since ever block of code within curly braces has its own lexical scope.
So to complete the functionality we are looking for we want to check the result of the test, if it evaluates to true we want to keep the consequent BlockStatement. If the test is false and there is an alternate BlockStatement then we want to keep this BlockStatement and if there is no alternate then we remove the entire node.

```javascript
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

Some References:

https://www.ecma-international.org/ecma-262/
https://nodejs.org/docs/latest/api/modules.html#modules_the_module_object
https://github.com/webpack/docs/wiki/commonjs
https://stackoverflow.com/questions/16383795/difference-between-module-exports-and-exports-in-the-commonjs-module-system
