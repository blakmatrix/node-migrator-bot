var flatiron = require('flatiron'),
    path     = require('path'),
    XRegExp  = require('xregexp').XRegExp,
    fs       = require('fs'),
    path     = require('path'),
    async    = require('async'),
    request  = require('request'),
    github   = require('octonode'),
    util     = require('util'),
    exec     = require('child_process').exec,
    username = 'XXXXXXXXXX',
    password = 'XXXXXXXXXX',
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

  if (XRegExp.test(link, re)) {
    app.log.info(link.blue.bold+' is a url');
    forkAndFix(link, cb);
  }else{
    app.log.info(link.blue.bold+' is a folder');
    walkAndFix(link, cb);
  }
}
function forkAndFix(link, cb){
  
  var parse    = XRegExp(/.*github.com\/(.*)\/(.*?)(\.git$|$)/g);
  var user     = XRegExp.replace(link, parse, '$1');
  var repo     = XRegExp.replace(link, parse, '$2');
  var forkedRepo = 'https://github.com/'+username+'/'+repo;
  var tmpDir = path.resolve(path.join('.','tmp'));
  var repoLocation = path.resolve(path.join(tmpDir,repo)).toString();

  app.log.info('Forking '+user.magenta.bold+'/'+repo.yellow.bold);
  async.waterfall([
    function(callback){
      forkRepo( forkedRepo, username, user, repo, repoLocation, callback);
    },//fork
    function(forkedRepo, username, repo, repoLocation, callback){
      notifyAvailability(forkedRepo, username, repo, repoLocation, callback);
    },//,// wait for availability (whilst)
    function(forkedRepo, repoLocation, callback){
      cloneRepo(forkedRepo, repoLocation, callback);
    },// clone repo
    function(repoLocation, callback){
      walkAndFix(repoLocation, callback);
    }//,// walkAndFix -- need to change link to proper diectory
    // push
    // pull
    ],
    function(err, results){//callback
      if (err) {
          return cb(err);
        }
        app.log.info('results = '+results);
        app.log.info('Finished fixing '+link.blue.bold);
  });

}
function forkRepo( forkedRepo, username, user, repo, repoLocation, cb){
  var client   = github.client({
    username: username,
    password: password
  });

  client.me().fork(user+'/'+repo, function(err, data){
    if(err){
      app.log.error('error: '+err);
      app.log.error('data:  '+data);
      cb(err);
    }else{
      return cb(null, forkedRepo, username, repo, repoLocation);
    }
  });
}
function cloneRepo(forkedRepo, repoLocation, cb){
  app.log.info("Attempting to clone "+ forkedRepo.blue.bold);
  var cmd = 'git clone '+forkedRepo+' "'+repoLocation+'"';
  app.log.debug('calling: "'+cmd+'"');
  var child = exec(cmd,
    function (error, stdout, stderr) {
      //app.log.debug('stdout: ' + stdout);
      //app.log.debug('stderr: ' + stderr);
      if (error !== null) {
        //app.log.error('exec error: ' + error);
        return cb(error);
      }else{
        app.log.info(forkedRepo.blue.bold+' Succesfully cloned to '+repoLocation.yellow.bold);
        return cb(null, repoLocation);
      }
  });
}

function notifyAvailability(forkedRepo, username, repo, repoLocation, cb){
  var count    = 0;
  var Available = false;
  async.until(// wait for availability (whilst)
      function () {
        if( count % 2 === 0 ){
          app.log.info('Waiting for '+username.magenta.bold+'/'+repo.yellow.bold+' to become available...');
        }
        request.head(forkedRepo, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            Available = true;
          }
        });
        return count > 300 || Available;
      },
      function (cb) {
          count++;
          setTimeout(cb, 2000);
      },
      function (err) {
          // 5 minutes have passed
          if(count > 300){
            app.log.error('Unable to find forked repo '+username.magenta.bold+'/'+repo.yellow.bold+' after 5 minutes.');

          }else{
          app.log.info('Forked repo '+username.magenta.bold+'/'+repo.yellow.bold+' Exists!');
          if(Available){
            return cb(null, forkedRepo, repoLocation);
          }else{
            return cb("error: Timeout");
          }
        }
      }
    );
}

function walkAndFix(link, cb){
  walk(link, function(err, results) {
      if (err) {
        return cb(err);
      }

      async.forEach(results, doFileUpdate ,cb);

    });
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
    app.log.warn('node-migrator-bot'.grey + ' NOT OK.');
    return process.exit(1);
  }
  app.log.info('node-migrator-bot'.grey + ' ok'.green.bold);
});

