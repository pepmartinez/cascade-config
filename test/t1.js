var CC = require('../');
var async = require('async');
var should = require('should');

var MongoClient = require('mongodb').MongoClient;


var mongodb_url = 'mongodb://localhost:27017/test';
var mongodb_coll = 'mconf_test';

describe('cascade-config test', function () {
  describe('plain, nontemplated', function () {
    var mongodb_url = 'mongodb://localhost:27017';
    mongodb_db = 'test';
    var mongodb_coll = 'mconf_test';

    before(function (done) {
      MongoClient.connect(mongodb_url, function (err, client) {
        var collection = client.db(mongodb_db).collection(mongodb_coll);
        collection.drop(function () {
          collection.insertMany([
            { _id: 'zxcvbnm', b: 1, cc: { a: 1, b: 2 } },
            { _id: '666', b: 2 },
            { _id: 'asdfgh', b: 3 },
            { _id: 'qwerty', c: 666, h: 'tyeryter' },
          ], function (err, result) {
            client.close();
            done(err);
          });
        });
      });
    });

    after(function (done) {
      MongoClient.connect(mongodb_url, function (err, client) {
        var collection = client.db(mongodb_db).collection(mongodb_coll);
        collection.drop(function (err, result) {
          client.close();
          done(err);
        });
      });
    });

    it('does read and merge objects ok', function (done) {
      var mconf = new CC();

      mconf
        .obj({ a: 'b', b: { c: 1, d: 4 } })
        .obj({ nnn: '666', b: { jj: 66 } })
        .obj({ b: { d: 'qwerty' } })
        .done(function (err, cfg) {
          cfg.should.eql({ a: 'b', b: { c: 1, d: 'qwerty', jj: 66 }, nnn: '666' });
          done();
        })
    });

    it('does read and merge objects, args, env and files ok', function (done) {
      var mconf = new CC();
      
      process.env ['elmer.zzz[0].cc'] = 'ttt';
      process.env ['elmer.zzz[1]__cc'] = 'ggg';

      process.argv = ['node', 'index.js', '-x', '3', '--b__bb__g=getty', '--zzz[2]__v=967'];

      mconf
        .obj  ({ a: 'b', b: { c: 1, d: 4 } })
        .file (__dirname + '/etc/d1/f1.js')
        .obj  ({ nnn: '666', b: { jj: 66 } })
        .file (__dirname + '/etc/d2/f1.js')
        .env  ({prefix: 'elmer.'})
        .args ()
        .obj  ({ b: { d: 'qwerty' } })
        .done(function (err, cfg) {
          cfg.should.eql({
            a: 'b',
            b: { bb: {g: 'getty'}, c: 1, d: 'qwerty', jj: 66 },
            t1: 6635,
            tt: { a: 1345, b: '244' },
            nnn: '666',
            x: 3,
            zzz: [{cc: 'ttt'}, {cc: 'ggg'}, {v: 967}]
          });

          done();
        })
    });

    it('does return empty object on nonexistent file', function (done) {
      var mconf = new CC();

      mconf.file('nonexistent.js', {ignore_missing: true})
        .done(function (err, cfg) {
          cfg.should.eql({});
          done();
        })
    });

    it('does read and merge from mongodb ok', function (done) {
      var mconf = new CC();

      mconf
        .mongodb({ url: mongodb_url, db: mongodb_db, coll: mongodb_coll, id: '666' })
        .mongodb({ url: mongodb_url, db: mongodb_db, coll: mongodb_coll, id: 'zxcvbnm' })
        .mongodb({ url: mongodb_url, db: mongodb_db, coll: mongodb_coll, id: 'qwerty' })
        .done(function (err, cfg) {
          cfg.should.eql({ b: 1, cc: { a: 1, b: 2 }, c: 666, h: 'tyeryter' });
          done();
        })
    });

    it('does return empty object on nonexistent mongodb', function (done) {
      var mconf = new CC();

      mconf
        .mongodb({ url: mongodb_url, db: mongodb_db, coll: mongodb_coll, id: 'nonexistent' })
        .done(function (err, cfg) {
          cfg.should.eql({});
          done();
        })
    });

    it('does read and merge entire dir ok', function (done) {
      var mconf = new CC();

      mconf.directory({ files: __dirname + '/etc' }).done(function (err, cfg) {
        if (err) return done(err);
        cfg.should.eql({
          development: {                                                                                                    
            'f-development': {                                                                                                
              t1: 66,                                                                                                        
              tt: {                                                                                                         
                a: 1,                                                                                                        
                b: '2'                                                                                                      
              }                                                                                                               
            }                                                                                                                 
          },  
          f1: {
            t1: 66,
            tt: {
              a: 1,
              b: "2"
            }
          },
          d1: {
            f1: {
              t1: 667,
              tt: {
                a: 14,
                b: "25"
              }
            }
          },
          d2: {
            f1: {
              t1: 6635,
              tt: {
                a: 1345,
                b: "244"
              }
            }
          },
          d3: {
            f1: {
              t1: 66345763,
              tt: {
                a: 1567457,
                b: "2jrjrtyj"
              }
            }
          },
          'templated-getty-deflt': {
            zzz: 66,
            zzzz: {
              a: 1,
              b: 'it is quite enough',
            }
          }
      
        });

        done();
      })
    });
  });

  describe('templated', function () {
    var mongodb_url = 'mongodb://localhost:27017';
    mongodb_db = 'db_development_';
    var mongodb_coll = 'mconf_development_';

    before(function (done) {
      MongoClient.connect(mongodb_url, function (err, client) {
        var collection = client.db(mongodb_db).collection(mongodb_coll);
        collection.drop(function () {
          collection.insertMany([
            { _id: 'id-development-6', b: 1, cc: { a: 1, b: 2 } },
          ], function (err, result) {
            client.close();
            done(err);
          });
        });
      });
    });

    after(function (done) {
      MongoClient.connect(mongodb_url, function (err, client) {
        var collection = client.db(mongodb_db).collection(mongodb_coll);
        collection.drop(function (err, result) {
          client.close();
          done(err);
        });
      });
    });

    it('merges from templatized files ok', function (done) {
      var mconf = new CC();

      mconf
        .obj({ a: 'b', b: { c: 1, d: 4 } })
        .file(__dirname + '/etc/{env}/f-{env}.js')
        .done(function (err, cfg) {
          cfg.should.eql({
           a: 'b', b: { c: 1, d: 4 }, t1: 66, tt: { a: 1, b: '2' }
          });

          done();
        });
    });

    it('merges from templatized mongo ok', function (done) {
      var mconf = new CC();

      mconf
        .obj ({ggg: 3, gamma: {a: 6}})
        .mongodb({ url: 'mongodb://localhost:27017', db: 'db_{env}_', coll: 'mconf_{env}_', id: 'id-{env}-{gamma.a}'})
        .done(function (err, cfg) {
          cfg.should.eql({ b: 1, cc: { a: 1, b: 2 }, ggg: 3, gamma: {a: 6}});
          done();
        });
    });

    it('process templatized values ok', function (done) {
      process.env ['APP_sub__x'] = 'ttt';
      process.env ['APP_sab__y'] = 'ggg';

      process.argv = ['node', 'index.js', '-x', '3', '--b__bb__g=getty', '--a__b__c=967'];

      var mconf = new CC();

      mconf 
        .env  ({prefix: 'APP_'})
        .args ()
        .obj  ({ 
          b: { 
            a: 'ideal {sub.x} or not',
            b: 'surreal {b.bb.g} always or {a.b.c:666}',
            c: 'be as {b.g.n} on a {b.b.c:666}',
            d: 'something_{undefined}_fishy' 
          } 
        })
        .obj  ({
          second_stage: {
            aaaa: 'guess what: {b.b} all the time',
            bbbb: 'do [{sab.y}] or [{go_figure:flee}]'
          } 
        })
        .file(__dirname + '/etc/templated-{b.bb.g}-{unknown.non:deflt}.js')
        .done(function (err, cfg) {
          cfg.should.eql ({ 
            sub: { x: 'ttt' },
            sab: { y: 'ggg' },
            x: 3,
            b: { 
              bb: { g: 'getty' },
              a: 'ideal ttt or not',
              b: 'surreal getty always or 967',
              c: 'be as  on a 666',
              d: 'something__fishy' 
            },
            a: { b: { c: 967 } },
            second_stage: { 
              aaaa: 'guess what: surreal getty always or 967 all the time',
              bbbb: 'do [ggg] or [flee]' 
            },
            zzz: 66,
            zzzz: { 
              a: 1, 
              b: 'it is do [ggg] or [flee] enough' 
            } 
          });
          
          done();
        });
    });
  });
});

