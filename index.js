var util =         require ('util');
var klaw =         require ('klaw');
var _ =            require ('lodash');
var path =         require ('path');
var fs =           require ('fs');
var async =        require ('async');
var parseArgs =    require ('minimist');
var Interpolator = require ('string-interpolation');
var traverse =     require ('traverse');
var MongoClient =  require ('mongodb').MongoClient;

var interpolator = new Interpolator();

function isCfg (item){
  var ext = path.extname (path.basename (item));
  return ext === '.js' || ext === '.json';
}

 
var _type_convs = {
  '#int': parseInt,
  '#float': parseFloat,
  '#bool': function (s) {return s === 'true';},
  '#base64': function (s) {return new Buffer(s, 'base64');}
};

function _type_conversion (str) {
  var idx = str.indexOf (':');

  if (idx == -1) return str;
  
  var sel = str.substr(0, idx);
  var val = str.substr(idx + 1);
  var conv = _type_convs[sel];
  if (!conv) return str;
  return conv(val);
}



/////////////////////////////////////////////
// does object substitution
function _expand (obj, cfg_so_far, cb) {
  traverse(obj).forEach(function (x) {
    if (_.isString (x)) {
      var nx = _type_conversion (interpolator.parse (x, cfg_so_far));
      if (nx != x) this.update (nx);
    }
  });
  
  cb (null, obj);
}


/////////////////////////////////////////////
// gets data from a plain object
function _from_obj (obj, cfg_so_far, cb) {
  _expand (obj, cfg_so_far, cb);
} 


/////////////////////////////////////////////
// gets data from command line arguments
function _from_args (opts, cfg_so_far, cb) {
  var args = parseArgs (opts.input || (process.argv.slice(2))); 
  var ka = [];
  var va = [];

  _.forEach (args, function (v, k) {
    if (k == '_') return;

    // change __ into . in k
    k = k.replace (/__/g, '.');

    if (opts.regexp && !(k.match (opts.regexp))) return;
    if (opts.prefix && !(_.startsWith (k, opts.prefix))) return;

    if (opts.prefix) k = k.substr (opts.prefix.length);

    ka.push (k);
    va.push (v);
  });

  var obj = _.zipObjectDeep(ka, va);
  _expand (obj, cfg_so_far, cb);
} 


/////////////////////////////////////////////
// gets data from env
function _from_env (opts, cfg_so_far, cb) {
  var ka = [];
  var va = [];

  _.forEach (process.env, function (v, k) {
    if (opts.regexp && !(k.match (opts.regexp))) return;
    if (opts.prefix && !(_.startsWith (k, opts.prefix))) return;

    if (opts.prefix) k = k.substr (opts.prefix.length);

    // change __ into . in k
    k = k.replace (/__/g, '.');

    ka.push (k);
    va.push (v);
  });

  var obj = _.zipObjectDeep(ka, va);
  _expand (obj, cfg_so_far, cb);
}


////////////////////////////////////////////////////////
// gets data from a file
function _from_file (fname_tmpl, opts, cfg_so_far, cb) {
  var vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);
  
  var fname = interpolator.parse (fname_tmpl, vals);

  // check existence
  fs.access (fname, function (err) {
    if (err) {
      if (opts.ignore_missing) {
        return cb (null, {});
      }
      else {
        return cb (err);
      }
    }

    var obj = {};
  
    try {
      obj = require (fname);
    } 
    catch (e) {
      return cb (e);
    }

    // expand variables in loaded object
    _expand (obj, vals, cb);
  });
} 


//////////////////////////////////////////////////////
// recursively get files in dir hierarchy, reflects hierarchy
function _from_dir (opts, cfg_so_far, cb) { 
  var cfg = {};
  var file_root_dir_tmpl = (opts && opts.files) || __dirname + '/etc';
  
  var vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);
  
  var file_root_dir = interpolator.parse (file_root_dir_tmpl, vals);

  klaw (file_root_dir, {})
  .on('data', function(item){
    if (item.stats.isFile() && isCfg (item.path)) {
      var pat = item.path
        .substr (file_root_dir.length + 1)
        .substr (0, item.path.length - (file_root_dir.length + 1) - (path.extname (item.path).length))
        .replace (/\./g, '_')
        .replace (/\//g, '.');

      var item_cfg = {};
      _.set (item_cfg, pat, require (item.path));
      _.merge (cfg, item_cfg);
    }
  })
  .on ('error', function (err) {
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
  .on('end', function () {
    // expand variables in loaded object
    _expand (cfg, vals, cb);
  });
}


//////////////////////////////////////////////
// gets data from mongodb. Both url, coll and id are templated
function _from_mongodb (opts, cfg_so_far, cb) {
  var vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);

  var url =  interpolator.parse (opts.url,  vals);
  var db =   interpolator.parse (opts.db,   vals);
  var coll = interpolator.parse (opts.coll, vals);
  var id =   interpolator.parse (opts.id,   vals);

  MongoClient.connect (url, function(err, client) {
    if (err) return cb (err);
    var collection = client.db (db).collection (coll);
    collection.find ({_id: id}).limit (1).next (function (err, doc) {
      client.close();

      if (err) {
        return cb (err);
      }
      else {
        if (doc) delete doc._id;

        // expand variables in loaded object
        _expand (doc, vals, cb);
      }
    });
  });
}


//////////////////////////////////////////////
var CascadeConfig = function () {
  this._tasks = [];
  this._cfg = {};
}


//////////////////////////////////////////////
CascadeConfig.prototype._merge = function (obj) {
  _.merge (this._cfg, obj);
}


//////////////////////////////////////////////
CascadeConfig.prototype.obj = function (oo) {
  var self = this;

  this._tasks.push (function (cb) {
    _from_obj (oo, self._cfg, function (err, res) {
      if (err) return cb (err);
      self._merge (res);
      return cb ();
    });
  });

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.args = function (opts) {
  var self = this;

  this._tasks.push (function (cb) {
    _from_args (opts || {}, self._cfg, function (err, res) {
      if (err) return cb (err);
      self._merge (res);
      return cb ();
    });
  });

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.env = function (opts) {
  var self = this;

  this._tasks.push (function (cb) {
    _from_env (opts || {}, self._cfg, function (err, res) {
      if (err) return cb (err);
      self._merge (res);
      return cb ();
    });
  });

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.file = function (fname, opts) {
  var self = this;

  this._tasks.push (function (cb) {
    _from_file (fname, opts || {}, self._cfg, function (err, res) {
      if (err) return cb (err);
      self._merge (res);
      return cb ();
    });
  });

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.directory = function (opts) {
  var self = this;

  this._tasks.push (function (cb) {
    _from_dir (opts, self._cfg, function (err, res) {
      if (err) return cb (err);
      self._merge (res);
      return cb ();
    });
  });

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.mongodb = function (opts) {
  var self = this;

  this._tasks.push (function (cb) {
    _from_mongodb (opts, self._cfg, function (err, res) {
      if (err) return cb (err);
      self._merge (res);
      return cb ();
    });
  });

  return this;
}


//////////////////////////////////////////////
CascadeConfig.prototype.done = function (cb) {
  var self = this;

  async.series (this._tasks, function (err) {
    if (err) return cb (err);
    return cb (null, self._cfg);
  })
}


//////////////////////////////////////////////
module.exports = CascadeConfig;
