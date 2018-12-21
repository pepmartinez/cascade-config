var CC = require('../');

var async =  require('async');
var _ =      require('lodash');
var should = require('should');


describe('cascade-config test', function () {
  describe('plain, nontemplated', function () {
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
        .file (__dirname + '/etc/tree/d1/f1.js')
        .obj  ({ nnn: '666', b: { jj: 66 } })
        .file (__dirname + '/etc/tree/d2/f1.js')
        .env  ({prefix: 'elmer.'})
        .args ()
        .args ({prefix: 'b.bb.'})
        .obj  ({ b: { d: 'qwerty' } })
        .done(function (err, cfg) {
          cfg.should.eql({
            a: 'b',
            b: { bb: {g: 'getty'}, c: 1, d: 'qwerty', jj: 66 },
            t1: 6635,
            tt: { a: 1345, b: '244' },
            nnn: '666',
            x: 3,
            zzz: [{cc: 'ttt'}, {cc: 'ggg'}, {v: 967}],
            g: 'getty'
          });

          done();
        })
    });

    it('does return empty object on nonexistent file (ignore_missing: true)', function (done) {
      var mconf = new CC();

      mconf.file('nonexistent.js', {ignore_missing: true})
        .done(function (err, cfg) {
          cfg.should.eql({});
          done();
        })
    });

    it('does return error on nonexistent file', function (done) {
      var mconf = new CC();

      mconf.file('nonexistent.js')
        .done(function (err, cfg) {
          err.code.should.equal ('ENOENT');
          done();
        })
    });

    it('does return error on malformed file', function (done) {
      var mconf = new CC();

      mconf.file(__dirname + '/etc/malformed.js', {ignore_missing: true})
        .done(function (err, cfg) {
          should (err).not.be.undefined();
          should (cfg).be.undefined();
          done();
        })
    });

    it('does read and merge entire dir ok', function (done) {
      var mconf = new CC();

      mconf.directory({ files: __dirname + '/etc/tree' }).done(function (err, cfg) {
        if (err) return done(err);
        cfg.should.eql({ 
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
        });

        done();
      })
    });
  });

  describe('templated', function () {
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

    it('converts types after expansion ok', function (done) {
      var mconf = new CC();

      mconf
        .file (__dirname + '/etc/types-base.js')
        .file (__dirname + '/etc/types.js')
        .done(function (err, cfg) {
          cfg.should.eql({ 
            p1: 666,
            aa: { a: 1, b: '2', c: true, d: false, e: 66.66 },
            w1: 666,
            ww: {
              a: 1,
              b: 2,
              c: true,
              d: false,
              e: 66.66,
              f: NaN,
              g: 'something:ggg:hhh',
              h: NaN,
              i: Buffer.from('JavaScript')
            } 
          });
          
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

  describe('extended', function () {
    it('loads ok', function (done) {
      var mconf = new CC();

      mconf
        .obj({ a: 'b', b: { c: 1, d: 4 } })
        .file(__dirname + '/etc/{env}/f-{env}.js')
        .done(function (err, cfg) {
          cfg.config ().should.eql({
            a: 'b', b: { c: 1, d: 4 }, t1: 66, tt: { a: 1, b: '2' }
          });

          cfg.get ('t1').should.eql (66);
          cfg.get ('tt.b').should.eql ('2');
          cfg.get ('b').should.eql ({ c: 1, d: 4 });

          done();
        }, {extended: true});
    });


    it('changes ok', function (done) {
      var mconf = new CC();

      mconf
        .obj({ a: 'b', b: { c: 1, d: 4 } })
        .file(__dirname + '/etc/{env}/f-{env}.js')
        .done(function (err, cfg) {
          var track = [];
          cfg.onChange (function (path) {track.push (path); track.push(_.cloneDeep (cfg.config ()));});

          async.series ([
            function (cb) {cb (null, cfg.unset ('b.e'))},
            function (cb) {cb (null, _.cloneDeep (cfg.config ()))},
            function (cb) {cb (null, cfg.unset ('b.c'))},
            function (cb) {cb (null, _.cloneDeep (cfg.config ()))},
            function (cb) {cfg.set ('b.c', 'yyy'); cb ()},
            function (cb) {cfg.set ('b.e', 'hhh'); cb ()},
            function (cb) {cb (null, _.cloneDeep (cfg.config ()))},
            function (cb) {cfg.reload (function (err) {cb (err)})},
            function (cb) {cb (null, _.cloneDeep (cfg.config ()))},
          ],
          function (err, res) {
            res.should.eql ([ 
              true,
              { a: 'b', b: { c: 1, d: 4 }, t1: 66, tt: { a: 1, b: '2' } },
              true,
              { a: 'b', b: { d: 4 }, t1: 66, tt: { a: 1, b: '2' } },
              undefined,
              undefined,
              { a: 'b',  b: { d: 4, c: 'yyy', e: 'hhh' }, t1: 66, tt: { a: 1, b: '2' } },
              undefined,
              { a: 'b', b: { c: 1, d: 4 }, t1: 66, tt: { a: 1, b: '2' } } ]
            );

            track.should.eql ([ 
              'b.e',
  { a: 'b', b: { c: 1, d: 4 }, t1: 66, tt: { a: 1, b: '2' } },
  'b.c',
  { a: 'b', b: { d: 4 }, t1: 66, tt: { a: 1, b: '2' } },
  'b.c',
  { a: 'b', b: { d: 4, c: 'yyy' }, t1: 66, tt: { a: 1, b: '2' } },
  'b.e',
  { a: 'b', b: { d: 4, c: 'yyy', e: 'hhh' }, t1: 66, tt: { a: 1, b: '2' } },
  undefined,
  { a: 'b', b: { c: 1, d: 4 }, t1: 66, tt: { a: 1, b: '2' } } ]
);

            done();
          });
        }, {extended: true});
    });

  });
});

