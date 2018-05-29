var util =      require ('util');
var klaw =      require ('klaw');
var _    =      require ('lodash');
var path =      require ('path');
var async =     require ('async');
var pupa =      require ('pupa');
var parseArgs = require ('minimist');

var MongoClient = require('mongodb').MongoClient;


function isCfg (item){
  var ext = path.extname (path.basename (item));
  return ext === '.js' || ext === '.json';
}


/////////////////////////////////////////////
// gets data from a plain object
function _from_obj (obj, cb) {
  cb (null, obj);
} 


/////////////////////////////////////////////
// gets data from command line arguments
function _from_args (opts, cb) {
  var args = parseArgs (opts.input || (process.argv.slice(2))); 
  var ka = [];
  var va = [];

  _.forEach (args, function (v, k) {
    if (k == '_') return;
    
    // change __ into . in k
    ka.push (k.replace (/__/g, '.'));
    va.push (v);
  });

  cb (null, _.zipObjectDeep(ka, va));
} 


/////////////////////////////////////////////
// gets data from env
function _from_env (opts, cb) {
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

  cb (null, _.zipObjectDeep(ka, va));
}


////////////////////////////////////////////////////////
// gets data from a file, allows {env} embedded in name
function _from_file (fname_tmpl, opts, cfg_so_far, cb) {
  var vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);
  
  var fname = pupa (fname_tmpl, vals);
  var obj = {};

  try {
    obj = require (fname);
  } 
  catch (e) {
    if (opts.ignore_missing) {
      return cb (null, {});
    }
    else {
      return cb (e);
    }
  }

  return cb (null, obj);
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
  
  var file_root_dir = pupa (file_root_dir_tmpl, vals);

  klaw (file_root_dir, {})
  .on('data', function(item){
    if (item.stats.isFile() && isCfg (item.path)) {
      var pat = item.path
        .substr (file_root_dir.length + 1)
        .substr (0,item.path.length - (file_root_dir.length + 1) - (path.extname (item.path).length))
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
      return cb (null, cfg);
    }
    else {
      console.error ('got error reading recursive config from %s: ', file_root_dir, err);
      return cb (err);
    }
  })
  .on('end', function () {
    return cb (null, cfg);
  });
}


//////////////////////////////////////////////
// gets data from mongodb. Both url, coll and id are templated
function _from_mongodb (opts, cfg_so_far, cb) {
  var vals = {
    env: process.env.NODE_ENV || 'development'
  };

  _.merge (vals, cfg_so_far);

  var url =  pupa (opts.url,  vals);
  var coll = pupa (opts.coll, vals);
  var id =   pupa (opts.id,   vals);

  MongoClient.connect (url, function(err, db) {
    if (err) return cb (err);

    var collection = db.collection (coll);
    collection.find ({_id: id}).limit (1).next (function (err, doc) {
      db.close();

      if (err) {
//        console.error ('got error reading config from mongo (url %s, coll %s, id %s): ', url, coll, id, e);
        return cb (err);
      }
      else {
        if (doc) delete doc._id;
        return cb (null, doc);
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
    _from_obj (oo, function (err, res) {
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
    _from_args (opts || {}, function (err, res) {
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
    _from_env (opts || {}, function (err, res) {
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
