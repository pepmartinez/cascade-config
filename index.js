const klaw =         require ('klaw');
const _ =            require ('lodash');
const path =         require ('path');
const fs =           require ('fs');
const async =        require ('async');
const parseArgs =    require ('minimist');
const Interpolator = require ('string-interpolation');
const traverse =     require ('traverse');
const importFresh =  require ('import-fresh');
const dotenv =       require ('dotenv');
const yaml =         require ('js-yaml');


const interpolator = new Interpolator();

function isCfg (item){
  const ext = path.extname (path.basename (item));
  return ext === '.js' || ext === '.json';
}


const _type_convs = {
  '#int':      parseInt,
  '#float':    parseFloat,
  '#bool':     function (s) {return s === 'true';},
  '#base64':   function (s) {return Buffer.from(s, 'base64');},
  '#str':      function (s) {return s.toString();},
  '#csv':      function (s) {return s.split(',').map(e => e.trim());},
  '#json':     function (s) {try { return JSON.parse(s) } catch (e) { return s} },
  '#file':     function (s) {try { return fs.readFileSync(s, 'utf8') } catch (e) { return s} },
  '#jsfile':   function (s) {try { return importFresh(s) } catch (e) { return s} },
  '#yamlfile': function (s) {try { return yaml.load (fs.readFileSync(s, 'utf8'), {filename: s}) } catch (e) { return s} },
};

function _type_conversion (str) {
  const idx = str.indexOf (':');

  if (idx == -1) return str;

  const sel = str.substring(0, idx);
  const val = str.substring(idx + 1);
  const conv = _type_convs[sel];
  if (!conv) return str;
  return conv(val);
}



/////////////////////////////////////////////
// does object substitution
function _expand (obj, cfg_so_far, cb) {
  const new_obj = traverse(obj).map(function (x) {
    // expand only string values
    if (_.isString (x)) {
      let nx = x;

      if (
        (x.startsWith ('#str:')) ||
        (x.startsWith ('#json:'))
      ) {
        // do not expand vars
        nx = _type_conversion (x);
      }
      else {
        // expand vars
        nx = _type_conversion (interpolator.parse (x, cfg_so_far));
      }

      if (nx != x) this.update (nx);
    }
  });

  cb (null, new_obj);
}


/////////////////////////////////////////////
// gets data from a plain object
function _from_obj (obj, cfg_so_far, cb) {
  _expand (obj, cfg_so_far, cb);
}


/////////////////////////////////////////////
// gets data from command line arguments
function _from_args (opts, cfg_so_far, cb) {
  const args = parseArgs (opts.input || (process.argv.slice(2)));
  const ka = [];
  const va = [];

  _.forEach (args, (v, k) => {
    if (k == '_') return;

    // change __ into . in k
    k = k.replace (/__/g, '.');

    if (opts.regexp && !(k.match (opts.regexp))) return;
    if (opts.prefix && !(_.startsWith (k, opts.prefix))) return;

    if (opts.prefix) k = k.substring (opts.prefix.length);

    ka.push (k);
    va.push (v);
  });

  const obj = _.zipObjectDeep(ka, va);
  _expand (obj, cfg_so_far, cb);
}


/////////////////////////////////////////////
// gets data from env
function _from_env (opts, cfg_so_far, cb) {
  const ka = [];
  const va = [];

  _.forEach (process.env, (v, k) => {
    if (opts.regexp && !(k.match (opts.regexp))) return;
    if (opts.prefix && !(_.startsWith (k, opts.prefix))) return;

    if (opts.prefix) k = k.substring (opts.prefix.length);

    // change __ into . in k
    k = k.replace (/__/g, '.');

    ka.push (k);
    va.push (v);
  });

  const obj = _.zipObjectDeep(ka, va);
  _expand (obj, cfg_so_far, cb);
}


////////////////////////////////////////////////////////
// gets data from a file
function _from_file (fname_tmpl, opts, cfg_so_far, cb) {
  const vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);

  const fname = interpolator.parse (fname_tmpl, vals);

  // check existence
  fs.access (fname, err => {
    if (err) {
      if (opts.ignore_missing) return cb (null, {});
      else return cb (err);
    }

    let obj = {};

    try {
      obj = importFresh (fname);
    }
    catch (e) {
      return cb (e);
    }

    // expand variables in loaded object
    _expand (obj, vals, cb);
  });
}

/////////////////////////////////////////////
// gets data from envfile
function _from_envfile (fname_tmpl, opts, cfg_so_far, cb) {
  const vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);

  const fname = interpolator.parse (fname_tmpl, vals);

// check existence
  fs.access (fname, err => {
    if (err) {
      if (opts.ignore_missing) return cb (null, {});
      else return cb (err);
    }

    try {
      const readf = fs.readFileSync (fname);
      const envConfig = dotenv.parse (readf);
      const ka = [];
      const va = [];

      if (!opts) opts = {};

      _.forEach (envConfig, (v, k) => {
        if (opts.regexp && !(k.match (opts.regexp))) return;
        if (opts.prefix && !(_.startsWith (k, opts.prefix))) return;
        if (opts.prefix) k = k.substr (opts.prefix.length);

        // change __ into . in k
        k = k.replace (/__/g, '.');

        ka.push (k);
        va.push (v);
      });

      const obj = _.zipObjectDeep (ka, va);

      // expand variables in loaded object
      _expand (obj, vals, cb);

    } catch (e) {
      return cb (e);
    }
  });
}


//////////////////////////////////////////////////////
// recursively get files in dir hierarchy, reflects hierarchy
function _from_dir (opts, cfg_so_far, cb) {
  const cfg = {};
  const file_root_dir_tmpl = (opts && opts.files) || __dirname + '/etc';

  const vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);

  const file_root_dir = interpolator.parse (file_root_dir_tmpl, vals);

  klaw (file_root_dir, {})
  .on('data', item => {
    if (item.stats.isFile() && isCfg (item.path)) {
      const pat = item.path
        .substring (file_root_dir.length + 1)
        .substring (0, item.path.length - (file_root_dir.length + 1) - (path.extname (item.path).length))
        .replace (/\./g, '_')
        .replace (/\//g, '.');

      const item_cfg = {};
      _.set (item_cfg, pat, importFresh (item.path));
      _.merge (cfg, item_cfg);
    }
  })
  .on ('error', err => {
    if ((err.code === 'ENOENT') && (err.path === file_root_dir)) {
      // ignore

      // expand variables in loaded object
      _expand (cfg, vals, cb);
    }
    else {
      console.error ('got error reading recursive config from %s: ', file_root_dir, err);
      return cb (err);
    }
  })
  .on('end', () => {
    // expand variables in loaded object
    _expand (cfg, vals, cb);
  });
}


////////////////////////////////////////////////////////
// gets data from a yaml file
function _from_yaml_file (fname_tmpl, opts, cfg_so_far, cb) {
  const vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);

  const fname = interpolator.parse (fname_tmpl, vals);

  // check existence
  fs.access (fname, err => {
    if (err) {
      if (opts.ignore_missing) return cb (null, {});
      else return cb (err);
    }

    let obj = {};

    try {
      obj = yaml.load (fs.readFileSync(fname, 'utf8'), {filename: fname});
    }
    catch (e) {
      return cb (e);
    }

    // expand variables in loaded object
    _expand (obj, vals, cb);
  });
}


//////////////////////////////////////////////
const CascadeConfig = function () {
  this._tasks = [];
  this._cfg = {};
}


//////////////////////////////////////////////
CascadeConfig.prototype._merge = function (obj, opts) {
  const mount = opts && opts.mount;
  if (!mount) return _.merge (this._cfg, obj);

  // mount result elsewhere
  _.merge (this._cfg, _.set ({}, mount, obj));
}


//////////////////////////////////////////////
CascadeConfig.prototype.obj = function (oo, opts) {
  this._tasks.push (cb => _from_obj (oo, this._cfg, (err, res) => {
    if (err) return cb (err);
    this._merge (res, opts);
    return cb ();
  }));

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.args = function (opts) {
  this._tasks.push (cb => _from_args (opts || {}, this._cfg, (err, res) => {
    if (err) return cb (err);
    this._merge (res, opts);
    return cb ();
  }));

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.env = function (opts) {
  this._tasks.push (cb => _from_env (opts || {}, this._cfg, (err, res) => {
    if (err) return cb (err);
    this._merge (res, opts);
    return cb ();
  }));

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.file = function (fname, opts) {
  this._tasks.push (cb => _from_file (fname, opts || {}, this._cfg, (err, res) => {
    if (err) return cb (err);
    this._merge (res, opts);
    return cb ();
  }));

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.envfile = function (fname, opts) {
  this._tasks.push (cb => _from_envfile (fname, opts || {}, this._cfg, (err, res) => {
     if (err) return cb (err);
     this._merge (res, opts);
     return cb ();
  }));

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.directory = function (opts) {
  this._tasks.push (cb => _from_dir (opts, this._cfg, (err, res) => {
    if (err) return cb (err);
    this._merge (res, opts);
    return cb ();
  }));

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.yaml = function (fname, opts) {
  this._tasks.push (cb => _from_yaml_file (fname, opts || {}, this._cfg, (err, res) => {
    if (err) return cb (err);
    this._merge (res, opts);
    return cb ();
  }));

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype._resolve = function (cb) {
  Object.keys(this._cfg).forEach(key => delete this._cfg[key]);

  async.series (this._tasks, err => {
    if (err) return cb (err);
    return cb (null, this._cfg);
  })
}



const Config = function (cc) {
  this._cc = cc;
  this._change_listeners = [];
}


Config.prototype.config = function () {
  return this._cc._cfg;
}

Config.prototype.get = function (k, dflt) {
  return _.get (this._cc._cfg, k, dflt);
}

Config.prototype.set = function (k, v) {
  const ret = _.set (this._cc._cfg, k, v);
  this._change (k);
  return ret;
}

Config.prototype.unset = function (k) {
  const ret = _.unset (this._cc._cfg, k);
  if (ret) this._change (k);
  return ret;
}

Config.prototype.reload = function (cb) {
  this._cc._resolve ((err, cfg) => {
    if (err) return cb (err);
    this._change ();
    cb (null, this);
  });
}

Config.prototype.onChange = function (cb, opts) {
  this._change_listeners.push (cb);
}

Config.prototype._change = function (path) {
  _.forEach (this._change_listeners, l => l (path));
}


//////////////////////////////////////////////
CascadeConfig.prototype.done = function (cb, opts) {
  if (!opts) opts = {};

  if (opts.extended) {
    const c = new Config (this);
    c.reload (cb);
  }
  else {
    this._resolve (cb);
  }
}


//////////////////////////////////////////////
// ass static-like utils
CascadeConfig.prototype._expand =       _expand;
CascadeConfig.prototype._interpolator = interpolator;

module.exports = CascadeConfig;
