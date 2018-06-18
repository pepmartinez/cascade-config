# cascade-config
Asynchronous hierarchical config for node.js (env, argv, files, dirs) with inline var substitution and type conversion

## Quick Start
`cascade-config` works by loading config objects from different sources and merging them together. 6 types of sources are provided:

* file: object is loaded using `require`
* directory: a full hierarchy of files are loaded, reflecting the hierarchy in the loaded object
* env: object is composed from env vars
* obj: object is explicitly specified
* args: object is composed from command line args
* mongodb: object is read from mongodb

The objects are loaded in the order their methods are called, so latter calls take precedence (an object loaded later would overwrite what is already loaded, by merge)

Also, one can specify as many loaders as required, even repeating types (that is, loading from more than one file is perfectly doable)

Let us see a quick example
```javascript
var CC = require ('cascade-config');

var cconf = new CC();
var defaults = {...};

cconf
  .obj (defaults)
  .file (__dirname + '/etc/config.js',       {ignore_missing: true})
  .file (__dirname + '/etc/config-{env}.js', {ignore_missing: true})
  .env ({prefix: 'MYAPP_'})
  .args ()
  .done (function (err, config) {
    // merged config at 'config' object
  });
```

## Variable substitution
CC supports using variables already read when calling certain loaders (file and mongodb). A very useful example is to use already-loaded config to specify the path of a file to load:

```javascript
cconf
  .obj ({a:{b:'one'}})
  .file (__dirname + '/resources-{a.b}.js')
  .done (function (err, config) {
    // config will contain what's in ./resources-one.js
  });
```
Variable substitution is made with [string-interpolation](https://www.npmjs.com/package/string-interpolation) so you can use any modifier allowed by it (defaults, transformations...)

Also, variable 'env' is always available, containing `NODE_ENV`. This makes it very simple to load configuration depending on the environment (production, development...):
```javascript
cconf
  .file (__dirname + '/etc/config.js')
  .file (__dirname + '/etc/config-{env}.js')
  .done (function (err, config) {
    // if NODE_ENV=='development', it will load ./etc/config.js and
    // then ./etc/config-development.js
  });
```

Variable substitution works also on the loaded objects on each source: what is loaded so far in previous sources is used as source to substitute. Note that the substitution is applied only to the values (not to keys) and only if the value is a string. See an example:
```javascript
// ENV is: APP_A=qwerty, APP_B__C__D=66
// cl is node index.js -a 66 --some.var=option_{B.C.D} --some__other__var=qwerty
// etc/config.js contains {z: {y: 'one_{some.var}_cc'}}
cconf
  .env ({prefix: 'APP_'})
    // env vars are available to substitute args...
  .args()
    // env vars and args are available to substitute file contents...
  .file (__dirname + '/etc/config.js') 
  .done (function (err, config) {
    /*
    config would be
    {
      A: 'qwerty',
      B: {
        C: {
          D: 66
        }
      }
      a: 66,
      some: {
        var: 'option_66'
        other: {
          var: 'qwerty'
        }
      },
      z: {
        y: 'one_option_66_cc'
      }
    }
    */
  });
```
Notice `z.y` is built through 2 substitutions: `some.var` is built using `B.C.D`, and then z.y is built usint `some.var`

This works on *all* source types

## Type conversion
Since variable substitution works only for string values, it is useful to have some sort of type conversion mechanism to convert string values into other types. cascade-config does this by looking whether the string begins with a specific prefix:
* `'#int:'`  converts the rest of the string into an int (using `parseInt`)
* `'#float:'`  converts the rest of the string into a float (using `parseFloat`)
* `'#bool:'`  converts the rest of the string into a boolean (as in `value === 'true'`)
* `'#base64:'` converts the rest of the string into a `Buffer` by base64-decoding it

let see an example:
```javascript

cconf
  .obj ({a: 1, b: '2', c: 'true', d: 'SmF2YVNjcmlwdA==', e: 67.89, f:'123.456'})
  .obj ({
    p1: '#int:{a}', 
    p2: '#int:{b}',
    p3: '#int:{c}',
    p4: '#bool:{c}',
    p5: '#base64:{d}',
    p6: '#float:{e}',
    p7: '#float:{f}'
  })
  .done (function (err, config) {
    /*
    config would be
    { 
      a: 1,
      b: '2',
      c: 'true',
      d: 'SmF2YVNjcmlwdA==',
      e: 67.89,
      f: '123.456',
      p1: 1,
      p2: 2,
      p3: NaN,
      p4: true,
      p5: Buffer [ 74, 97, 118, 97, 83, 99, 114, 105, 112, 116 ],
      p6: 67.89,
      p7: 123.456 
    }
    */
  });
```

## API

* `.obj(object)`: loads and merges an object, verbatim. USeful to provide defaults (if loaded first) or overrides (if loaded last)
* `.env(opts)`: loads and merges an object composed with env vars. `opts` can be passed to control what env vars to pick:
  * `prefix: str`: selects all vars with name starting with `str`, and removes the prefix before adding it to the object
  * `regexp: regex`: selects all vars whose name matches `regex`
In all cases, one can produce deep objects (ie subobjects) by adding `__` to the var name: it will be treated as a `.` 
    ```javascript
    // ENV is: APP_A=qwerty, APP_B__C__D=66, SOME__OTHER__VAR=0, AND__ANOTHER__VAR=8
    cconf
      .env ({prefix: 'APP_'})
      .env ({regexp: /OTHER/})
      .done (function (err, config) {
        /* config would be 
        { 
          A: 'querty', 
          B: {
            C: {
              D: 66
            }
          },
          SOME: {
            OTHER: {
              VAR: 0
            }
          }
        }
        */
      });
    ```
* `.args(opts)`:  loads and merges an object composed with the command line args passed (parsed by `minimist`). As in the case of `env()` all occurrences of `__` are converted to `.`, so one can use either to specify hierarchy
  ```javascript
  // cl is node index.js -a 66 --some.var=rt --some__other__var=qwerty
  cconf.args().done (function (err, config) {
    /*
    config would be
    {
      a: 66,
      some: {
        var: 'rt',
        other: {
          var: 'qwerty'
        }
      }
    }
    */
  });
  ```
  A single option `input` is allowed: a string that would be used as source for minimist instead of `process.argv.slice(2)`

* `.file(filename, opts)`: loads object from a file. `filename` supports variable substitution. Options are:
  * `ignore_missing`: if truish, jus return an empty object if the file can not be read; if false, raise an error. Defaults to false
* `.directory(opts)`: loads a single object composed by an entire file hierarchy. Only js and json files are considered, and the resulting object reflects the relative path of the file. That is, a file `a/b/c.js` containing `{n:1, b:6}` would produce `{a: {b: {c: {n: 1, b: 6}}}}`. Also, dots in file or dir names are changed into `_`. Options are:
  * `files`: base dir to read files from. defaults to `__dirname + '/etc'`, and supports variable substitution
* `.mongodb (opts)`: reads an object from a mongodb database, specified by mongodb url, database, collection and _id value. All 4 support variable substitution. Options are:
  * `url`: mongodb url (as supported by mongodb driver v3)
  * `db`: database to use
  * `coll`: collection to use
  * `id`: value of `_id` to seek within the collection. The `_id` itself is deleted from the returned object  