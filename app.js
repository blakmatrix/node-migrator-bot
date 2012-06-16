var flatiron = require('flatiron'),
    path     = require('path'),
    XRegExp  = require('xregexp').XRegExp,
    fs       = require('fs'),
    path     = require('path'),
    async    = require('async'),
    request  = require('request'),
    github   = require('octonode'),
    app      = flatiron.app;



app.config.file({ file: path.join(__dirname, 'config', 'config.json') });

app.use(flatiron.plugins.cli, {
  source: path.join(__dirname, 'lib', 'commands'),
  usage: [
    '',
    'node-migrator-bot - Migrate your old Node.js Repos',
    '',
    'Usage:',
    '',
    '    node-migrator-bot repo <myrepo> - Takes the URL link to your repository on',
    '                                      git hub, forks it, does its thing, then',
    '                                      initates a pull request. If a folder',
    '                                      path is given, runs file op for every file',
    '    node-migrator-bot user <user>   - Takes a github username, forks all node.js',
    '                                      repositories, does its thing, then',
    '                                      initates a pull request on each repository',
    '    node-migrator-bot file <file>   - runs the bot on the file provided'
  ]
});

app.commands.repo = function file(link, cb) {
  this.log.info('Attempting to open path"' + link + '"');
  doRepoUpdate(link, cb);
};

app.cmd('user', function(){
  app.prompt.get('name', function (err, result) {
    app.log.info('user is  '+result.name+'!');
  });
});

app.commands.file = function file(filename, cb) {
  this.log.info('Attempting to open "' + filename + '"');
  doFileUpdate(filename, cb);
};

function doRepoUpdate(link, cb){
  var re = /(http|ftp|https|git|file):\/\/(\/)?[\w-]+(\.[\w-]+)+([\w.,@?\^=%&amp;:\/~+#-]*[\w@?\^=%&amp;\/~+#-])?/gi;
  var user;
  var repo;
  var parse;
  if (XRegExp.test(link, re)) {
    app.log.info(link.blue.bold+' is a url');
    parse = XRegExp(/.*github.com\/(.*)\/(.*?)(\.git$|$)/g);
    user = XRegExp.replace(link, parse, '$1');
    repo = XRegExp.replace(link, parse, '$2');
    var client = github.client({
      username: 'CHANGEME',
      password: 'CHANGE_ME'
    });

    //client.get('/user', function (err, status, body) {
      //app.log.info(  body.toString() ); //json object
      //console.dir(body);
    //});

    app.log.info('Forking '+user.magenta.bold+'/'+repo.yellow.bold);
    client.me().fork(user+'/'+repo, cb);

  }else{
    app.log.info(link.blue.bold+' is a folder');
    walk(link, function(err, results) {
      if (err) {
        return cb(err);
      }

      async.forEach(results, doFileUpdate ,cb);

    });
  }
}
function forkAndFix(link, cb){

}
function walk(dir, done) {
  var results = [];
  fs.readdir(dir, function(err, list) {
    if (err) return done(err);
    var index = list.indexOf('.git');//remove git
    if(index >= 0){
      list.splice(index, 1);
    }
    var pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function(file) {
      file = path.resolve(path.join(dir,file));
      fs.stat(file, function(err, stat) {
        if (stat && stat.isDirectory()) {
          walk(file, function(err, res) {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
}

function doFileUpdate(filename, cb){
  fs.readFile(filename, function (err, data) {
    if (err) {
      return cb(err);
    }

    //app.log.info(data);
    //app.log.info("Regex");

    var re = /require\s*\(\s*['"]sys['"]\s*\)/g,
        reFull = /sys\s*=\s*require\s*\(\s*['"]sys['"]\s*\)/g,
        rePart = /sys\./g,
        replacement = "require('util')",
        replacementFull = "util = require('util')",
        replacementPart = 'util.',
        dataStr = data.toString();
        fixedDoc = '';

    if (XRegExp.test(dataStr, re)) {
      if (XRegExp.test(dataStr, reFull)) {
        fixedDoc = XRegExp.replace(XRegExp.replace(dataStr, rePart, replacementPart, 'all'), reFull, replacementFull, 'all');
      }
      else{
        fixedDoc = XRegExp.replace(dataStr, re, replacement, 'all');
      }
      //return cb(null, fixedDoc);
      // write changes out to file
      fs.writeFile(filename, fixedDoc, function(err) {
          if(err) {
            app.log.error('The file was not saved');
            cb(err);
          } else {
            app.log.info(filename.blue.bold+' was modified and changed!');
            cb(null);
          }
      });

    }
    else{
      app.log.debug('No '+'require(\'sys\')'.magenta.bold+' text found in '+filename.blue.bold+", no modifications made.");
      cb(null);
    }
  });
}

app.start( function (err){
  if (err) {
    app.log.error(err.message || 'You didn\'t call any commands!');
    app.log.warn('NOT OK.');
    return process.exit(1);
  }
  app.log.info('node-migrator-bot'.grey + ' ok'.green.bold);
});

