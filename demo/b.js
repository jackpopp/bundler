const React = require('react');
const ReactDOM = require('react-dom/server'); //- currently doesnt work
const somethingElse = require('./folder/something-else.js');

const el = React.createElement('a');
console.log(el);

function helloWorld() {
    console.log('Hello World');
    console.log(somethingElse);
}

module.exports = helloWorld;
