var helloWorld = require('./b.js');
require('./b.js');
require('./folder/something.js');
helloWorld();

for (let i = 0; i < 10; i++) {
    require('./b.js')();
}