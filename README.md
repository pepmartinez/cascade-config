# cascade-config
Asynchronous hierarchical config for node.js (env, argv, files, dirs) with inline var substitution and type conversion

## Quick Start
`cascade-config` works by loading config objects from different sources and merging them together. 7 types of sources are provided:

* JS file: object is loaded using `import-fresh`
* directory: a full hierarchy of js files are loaded, reflecting the hierarchy in the loaded object
* env: object is composed from env vars
* envfile: object is loaded from a env file, using `dotenv`
* obj: object is explicitly specified
* args: object is composed from command line args
* yaml: YAML files, loaded with `js-yaml`

External loaders also exist as separated packages (see below)

The objects are loaded in the order their methods are called, so latter calls take precedence (an object loaded later would overwrite what is already loaded, by merge)

Also, one can specify as many loaders as required, even repeating types (that is, loading from more than one file is perfectly doable)

Let us see a quick example
```javascript
const CC = require ('cascade-config');

const cconf = new CC();
const defaults = {...};

cconf
  .obj (defaults)
  .file (__dirname + '/etc/config.js',       {ignore_missing: true})
  .file (__dirname + '/etc/config-{env}.js', {ignore_missing: true})
  .env ({prefix: 'MYAPP_'})
  .args ()
  .done ((err, config) => {
    // merged config at 'config' object
  });
```

## Variable substitution
CC supports using variables already read when calling certain loaders (js file, yaml and directory, for example). A very useful example is to use already-loaded config to specify the path of a file to load:

```javascript
cconf
  .obj ({a:{b:'one'}})
  .file (__dirname + '/resources-{a.b}.js')
  .yaml (__dirname + '/other-resources-{a.b}.yaml')
  .done ((err, config) => {
    // config will contain what's in ./resources-one.js and in ./other-resources-one.yaml
  });
```
Variable substitution is made with [string-interpolation](https://www.npmjs.com/package/string-interpolation) so you can use any modifier allowed by it (defaults, transformations...)

Also, variable 'env' is always available, containing `NODE_ENV`. This makes it very simple to load configuration depending on the environment (production, development...):
```javascript
cconf
  .file (__dirname + '/etc/config.js')
  .file (__dirname + '/etc/config-{env}.js')
  .done ((err, config) => {
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
  .done ((err, config) => {
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

This works on *all* source types: if you want to provide a string verbatim, you can use the `#str:` type conversion, which will also prevent the variable substitution in it:

```javascript
cconf
  .obj ({
    p1: '#str:some mustache {{a}} and other exotics: []%&_-|@',
  })
  .done ((err, config) => {
    /*
    config would be
    {
      p1: 'some mustache {{a}} and other exotics: []%&_-|@'
    }
    */
  });
```

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
  .done ((err, config) => {
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

Note that `dotenv` starting with version 15.0.0 treats `#` as start of comment, unless the value is wrapped in double quotes; 
therefore to use this feature on an envfile you will need to elcose the value in double quotes:
```sh
a__b__c="#int:{previous_def_1}"
d__e = "#int:{previous_def_2}"
```

## API

* `.obj(object)`: loads and merges an object, verbatim. Useful to provide defaults (if loaded first) or overrides (if loaded last)
* `.env(opts)`: loads and merges an object composed with env vars. `opts` can be passed to control what env vars to pick:
  * `prefix: str`: selects all vars with name starting with `str`, and removes the prefix before adding it to the object
  * `regexp: regex`: selects all vars whose name matches `regex`
In all cases, one can produce deep objects (ie subobjects) by adding `__` to the var name: it will be treated as a `.`
    ```javascript
    // ENV is: APP_A=qwerty, APP_B__C__D=66, SOME__OTHER__VAR=0, AND__ANOTHER__VAR=8
    cconf
      .env ({prefix: 'APP_'})
      .env ({regexp: /OTHER/})
      .done ((err, config) => {
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
  cconf.args().done ((err, config) => {
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

  cconf.args({prefix: 'some.'}).done ((err, config) => {
    /*
    config would be
    {
      var: 'rt',
      other: {
        var: 'qwerty'
      }
    }
    */
  });
  ```
  Allowed options are:
  * `input`: a string that would be used as source for minimist instead of `process.argv.slice(2)`
  * `prefix: str`: selects all vars with name starting with `str`, and removes the prefix before adding it to the object
  * `regexp: regex`: selects all vars whose name matches `regex`

* `.file(filename, opts)`: loads object from a javascript file. `filename` supports variable substitution. Options are:
  * `ignore_missing`: if truish, just return an empty object if the file can not be read; if false, raise an error. Defaults to false

* `.envfile(filename, opts)`: loads object from an envfile. `filename` supports variable substitution. Options are:
  * `ignore_missing`: if truish, just return an empty object if the file can not be read; if false, raise an error. Defaults to false
  * `prefix: str`: selects all vars with name starting with `str`, and removes the prefix before adding it to the object
  * `regexp: regex`: selects all vars whose name matches `regex`

* `.directory(opts)`: loads a single object composed by an entire file hierarchy. Only js and json files are considered, and the resulting object reflects the relative path of the file. That is, a file `a/b/c.js` containing `{n:1, b:6}` would produce `{a: {b: {c: {n: 1, b: 6}}}}`. Also, dots in file or dir names are changed into `_`. Options are:
  * `files`: base dir to read files from. defaults to `__dirname + '/etc'`, and supports variable substitution

* `.yaml(filename, opts)`: loads object from a YAML file. `filename` supports variable substitution. Options are:
  * `ignore_missing`: if truish, just return an empty object if the file can not be read; if false, raise an error. Defaults to false

## Extended API
The api exposed so far provides a simple, plain JS object with all the config; this is usually more than enough, but for more complex use cases -where advanced config management is needed- a more powerful interface is provided

This extender interface is selected by simply passing `{extended: true}` as second param of `.done()`:

```javascript
  cconf
    .args({prefix: 'some.'})
    ...
    .done ((err, config) => {
     ...
    }, {extended: true}
  );
```

In this case `config` is no longer a plain object containing the config, but an interface to it with the following methods:

* `config()`: returns the plain config object (as in the standard interface)
* `get()`: gets a value or slice from the config. Uses the same interface, and has the same logic than lodash's `_.get(obj, ...)`
* `set()`: sets a value or slice in the config. Uses the same interface, and has the same logic than lodash's `_.set(obj, ...)`
* `unset()`: unsets a value or slice in the config. Uses the same interface, and has the same logic than lodash's `_.unset(obj, ...)`
* `reload (cb)`: rereads all config again, as if you called `done()`. It has, in fact, the same interface
* `onChange(fn)`: registers a function to be called every the the config is changed (by calling `set()`, `unset()` or `reload()`). Teh function will be called every time the config is changed, with the following params:
  * `function (path)`: where `path` is the path of the change within the configuration, or null if unknown or affects all the config

__*Note*__: the object returned by `config()` is mutable, but the object reference itself does not change: if you save it for later, you can read the new config in it after any change, `reload()` included, as expected

## External loaders
There are external packages that add loaders to `cascade-config`, thus allowing to read config from other type of sources:
* [cascade-config-mongodb](https://www.npmjs.com/package/cascade-config-mongodb) : reads config from mongodb databases
* [cascade-config-http](https://www.npmjs.com/package/cascade-config-http) : reads config from http URLs (with JSON payloads)
