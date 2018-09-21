const React = require('react');
const ReactDOM = require('react-dom');
const somethingElse = require('./folder/something-else.js');

const el = React.createElement('a', {
    href: 'hello'
}, 'This is a link');

console.log(ReactDOM.render(el, document.querySelector('#el')));

function helloWorld() {
    console.log('Hello World');
    console.log(somethingElse);
}

module.exports = helloWorld;
