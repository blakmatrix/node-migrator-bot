var flatiron = require('flatiron'),
    path     = require('path'),
    XRegExp  = require('xregexp').XRegExp,
    fs       = require('fs'),
    path     = require('path'),
    async    = require('async'),
    request  = require('request'),
    github   = require('octonode'),
    util     = require('util'),
    rimraf   = require('rimraf'),
    exec     = require('child_process').exec,
    redis    = require("redis"),
    app      = flatiron.app;

app.config.file({ file: path.join(__dirname, 'config', 'config.json') });

var username = app.config.get('username'),
    password = app.config.get('password'),
    BOTNAME  = app.config.get('BOTNAME'),
    port     = app.config.get('database:port'),
    host     = app.config.get('database:host'),
    pass     = app.config.get('database:password'),
    npm_hash = app.config.get('database:npm_hash');

var redisClient = redis.createClient(port, host);

redisClient.auth(pass, function (err) {
  if (err) {
    throw err;
  }
  app.log.info("REDIS Authed!");
});


var gitQue = async.queue(function (task, callback) {
    app.log.debug('GITQUE:'.cyan.bold + ' Running '.green.bold + task["info"].toString().magenta);
    callback(null, task);
  }, 1);

redisClient.on("error", function (err) {
  app.log.error("REDIS " + err.message);
  //return process.exit(1);
});



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

app.commands.db = function file(cb) {
  redisClient.hgetall(npm_hash, function (err, obj) {
    console.dir(obj);
    cb(null);
  });
};

app.commands.npm = function file(link, cb) {
  this.log.warn('Running on all available npm repositories that are hosted on github!!!'.red.bold);
  doNPMUpdate(cb);
  //npmShortCircuit(cb);
};

app.commands.user = function file(user, cb) {
  this.log.info('Attempting get information on "' + user + '"');
  doUserRepoUpdateStart(user, cb);
};

app.commands.file = function file(filename, cb) {
  this.log.info('Attempting to open "' + filename + '"');
  doFileUpdate(filename, cb);
};

app.start(function (err) {
  if (err) {
    app.log.error(err.message || 'You didn\'t call any commands!');
    app.log.warn(BOTNAME.grey + ' NOT OK.');
    redisClient.quit();
    return process.exit(1);
  }
  redisClient.quit();
  app.log.info(BOTNAME.grey + ' ok'.green.bold);
});





function doNPMUpdate(cb) {
  //app.log.debug("doNPMUpdate");
  getNPMRepos(function (err, results) {
    app.log.debug(results);
    async.forEachSeries(results.filter(function (x) { return typeof x !== 'undefined' && x !== null; }), doRepoUpdate, function (err) {
      if (err) {
        app.log.warn('Error processing npm repositories that are hosted on github!!!'.red.bold);
        return cb(err);
      } else {
        return cb(null, 'OK');
      }
    });
  });
}

function getNPMRepos(cb) {
  //app.log.debug("getNPMRepos");
  request('http://isaacs.couch.xxx/registry/_all_docs', function (err, res, body) {
    if (err) {
      return cb(err);
    }

    async.map(JSON.parse(body).rows, getNPMRepoLocation, function (err, results) {
      if (err) {
        return cb(err);
      }
      cb(null, results);
    });
  });
}

function getNPMRepoLocation(id_obj, cb) {
 // app.log.debug("getNPMRepoLocation");
  request('http://isaacs.couch.xxx/registry/' + id_obj.id, function (err, res, npmPackage) {
    if (err) {
      return cb(err);
    }
    if (JSON.parse(npmPackage).repository && JSON.parse(npmPackage).repository.url) {
      return cb(null, JSON.parse(npmPackage).repository.url);
    } else {
      app.log.debug('No Repo for ' + id_obj.id);
      cb(null);
    }

  });
}

function doUserRepoUpdateStart(user, cb) {
  var client   = github.client();
  app.log.info('Getting ' + user.red.bold + '\'s list of Repositories...');
  client.get('/users/' + user + '/repos', function (err, status, data) {
      if (err) {
        app.log.error('error:  ' + err);
        app.log.error('status: ' + status);
        app.log.error('data:   ' + data);
        return cb(err);
      } else {
        async.forEach(data, doUserRepoUpdate, cb);
      }
    });
}

function doUserRepoUpdate(repoData, cb) {
  doRepoUpdate(repoData["html_url"], cb);
}

function doRepoUpdate(link, cb) {
  var re = /(http|ftp|https|git|file):\/\/(\/)?[\w\-]+(\.[\w\-]+)+([\w.,@?\^=%&amp;:\/~+#\-]*[\w@?\^=%&amp;\/~+#\-])?/gi,
   reSSH = /git@github\.com:.*\/.*(\.git$|$)/g;

  redisClient.hget(npm_hash, link, function (err, hashk_value) {
    if (err) {
      app.log.error('There was a problem with finding the value of ' + npm_hash + ':' + link);
      return cb(err);
    }

    if (hashk_value === null) {
      if (XRegExp.test(link, re) || XRegExp.test(link, reSSH)) {
        app.log.info(link.blue.bold + ' is a url');
        forkAndFix(link, cb);
      } else {
        app.log.info(link.blue.bold + ' is a folder');
        walkAndFix(null, link, 'OK', cb);//NOTE: LINKE HERE IS the path!!!
      }
    } else {
      app.log.debug(link.yellow.bold + ' Has already been processed!');
      return cb(null, "DONE");
    }
  });
}

function forkAndFix(link, cb) {
  var parse        = XRegExp(/.*github.com[\/|:](.*)\/(.*?)(\.git$|$)/g),
      user         = XRegExp.replace(link, parse, '$1'),
      repo         = XRegExp.replace(link, parse, '$2'),
      forkedRepo   = 'https://github.com/' + username + '/' + repo,
      tmpDir       = path.resolve(path.join('.', 'tmp')),
      repoLocation = path.resolve(path.join(path.join(tmpDir, user), repo)).toString();

  app.log.info('Forking ' + user.magenta.bold + '/' + repo.yellow.bold);
  async.waterfall([
    function (callback) {
      forkRepo(link, forkedRepo, username, user, repo, repoLocation, callback);
    },//fork
    function (status, callback) {
      notifyAvailability(forkedRepo, username, repo, repoLocation, status, callback);
    },//,// wait for availability (whilst)
    function (status, callback) {
      gitQue.push({task: cloneRepo(repo, forkedRepo, repoLocation, status, callback), info: '   git:cloneRepo :: ' + forkedRepo});
    },// clone repo
    function (status, callback) {
      gitQue.push({task: switchBranch(forkedRepo, repoLocation, status, callback), info: 'git:switchBranch :: ' + forkedRepo});
    },// switch branch
    function (status, callback) {
      walkAndFix(link, repoLocation, status, callback);//? lose all variables?
    },// walkAndFix
    function (status, callback) {
      gitQue.push({task: commitRepo(link, forkedRepo, repoLocation, status, callback), info: '  git:commitRepo :: ' + forkedRepo});
    },// commit
    function (status, callback) {
      gitQue.push({task: pushCommit(forkedRepo, repoLocation, status, callback), info: '  git:pushCommit :: ' + forkedRepo});
    },// push
    function (status, callback) {
      submitPullRequest(link, username, user, repo, status, callback);
    },// submit pull request
    function (status, callback) {
      cleanUpFileSystem(repoLocation, callback);
    }//clean up filesystem
  ],
    function (err, result) {//callback
      if (err) {
        return cb(err);
      }
      app.log.info(BOTNAME.grey + ' Done with '.green + link.blue.bold + ' RESULT: '.grey + result);
      return cb(null, result);
    });
}

function cleanUpFileSystem(repoLocation, cb) {
  path.exists(repoLocation, function (exists) {//if exists
    if (exists) {
      rimraf(repoLocation, function (err) {
        if (err) {
          app.log.error('ERROR Removing Repository directory : '.red.bold + repoLocation.yellow.bold);
          return cb(err);
        }
        app.log.info('Removed Repository directory : ' + repoLocation.yellow.bold);
        return cb(null, 'DONE');
      });
    } else {
      app.log.warn('ERROR Repository directory does not exist : '.red.bold + repoLocation.yellow.bold);
      return cb(null, 'DONE');
    }
  });
}

function forkRepo(link, forkedRepo, username, user, repo, repoLocation, cb) {
  var client   = github.client({
    username: username,
    password: password
  });

  client.me().fork(user + '/' + repo, function (err, data) {
    if (err) {
      app.log.error(err + ' ' + link.yellow.bold);
      app.log.debug('data:  ' + data);
      return cb(err);
    } else {
      return cb(null, 'OK');
    }
  });
}

function submitPullRequest(link, username, user, repo, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  github.auth.config({
    username: username,
    password: password
  }).login(['user', 'repo', 'gist'], function (err, id, token) {
    app.log.info(id, token);//TODO: reuse tokens?

    var url = 'https://api.github.com/repos/' + user + '/' + repo + '/pulls?access_token=' + token,
        bodyMessage = [
      'Hello ' + user + '!',
      '',
      '',
      'I am ' + BOTNAME + ', an '
      + '[open-source](https://github.com/blakmatrix/node-migrator-bot) bot '
      + 'and I\'m here to help you migrate your codebase to node v0.8!',
      '',
      'Did you know that the "sys" module throws an error if your program '
      + 'tries to require it in node v0.8? To help keep your code running, '
      + 'I automatically replaced `var sys = require(\'sys\')` with '
      + '`var util = require(\'util\')`.',
      '',
      'If you\'d like to know more about these changes in node.js, take a look '
      + 'at https://github.com/joyent/node/commit/1582cf#L1R51 and '
      + 'https://github.com/joyent/node/blob/'
      + '1582cfebd6719b2d2373547994b3dca5c8c569c0/ChangeLog#L51 .',
      '',
      'Enjoy!',
      'Your Friendly Neighborhood '
      + '[' + BOTNAME + '](https://github.com/blakmatrix/node-migrator-bot)'
    ].join('\n'),
        payload = JSON.stringify({
      "title": "Hi! I fixed some calls to \"sys\" for you!",
      "body": bodyMessage,
      "base": "master",
      "head": username + ":clean"
    });

    /*
    var client   = github.client({
      username: username,
      password: password
    });

    client.repo(username + '/' + repo).create_pull_request_comment(
      'id', /// -> is this right?
      payload,
      function (err, data) {
        //TODO (if octonode ever implements)
      });*/
    app.log.debug('Attempting to make Pull Request to:\n' + url.green + ' with the following payload:\n\n ' + payload.cyan.bold);
    request.post({url: url, body: payload}, function (error, response, body) {
            if (!error && response.statusCode === 201) {//Status: 201 Created
              app.log.info('Pull Request to ' + user + '/' + repo + ' from ' + username + '/' + repo + ' Succesfull!');
              redisClient.hset(npm_hash, link, 'processed');

              return cb(null, 'DONE');
            } else {
              if (error === null) {
                try {
                  throw new Error(response.statusCode + ' ' + response.body.toString());
                }catch (err) {
                  app.log.error('submitPullRequest::error : ' + err);
                  return cb(null, 'DONE');
                }
              } else {
                return cb(error);
              }
            }
          });
  });
}

function cloneRepo(repo, forkedRepo, repoLocation, status, cb) {
  if (status === 'DONE') {
    app.log.info("Skipping clone of" +  forkedRepo.blue.bold);
    return cb(null, 'DONE');
  }
  var cmd, child;
  app.log.info("Attempting to clone " +  forkedRepo.blue.bold);
  //ssh git@github.com:username/repo.git
  //var cmd = 'git clone ' + forkedRepo + '.git "' + repoLocation + '"';
  cmd = 'git clone git@github.com:' + username + '/' + repo + '.git "' + repoLocation + '"';
  app.log.debug('calling: "' + cmd.grey + '"');
  child = exec(cmd,
    function (error, stdout, stderr) {
      if (error !== null) {
        app.log.warn('cloneRepo: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
        if (stderr.indexOf('already exists') !== -1) {
          app.log.warn(forkedRepo.blue.bold + ' FAILED cloned to '.red.bold + repoLocation.yellow.bold + ' : We may have already cloned this one!'.magenta.bold);
          return cb(null, 'OK'); //ok? should we assume it might not have been processed? Lets see where it goes... shouldn't hurt
        } else {
          return cb(error);
        }
      } else {
        app.log.info(forkedRepo.blue.bold + ' Succesfully cloned to ' + repoLocation.yellow.bold);
        return cb(null, 'OK');
      }
    });
}

function switchBranch(forkedRepo, repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  var gitDir, cmd1, cmd2, child;
  app.log.info("Attempting to switch branch on " +  repoLocation.blue.bold);
  gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
  cmd1 = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" branch clean';
  cmd2 = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" checkout clean';
  app.log.debug('calling: "' + cmd1.grey + '"');
  child = exec(cmd1,
    function (error, stdout, stderr) {
      if (error !== null && stderr !== 'fatal: A branch named \'clean\' already exists.\n') {
        app.log.warn('switchBranch::1: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
        console.dir(error);
        console.dir(stdout);
        console.dir(stderr);
        if (stderr === 'fatal: Not a valid object name: \'master\'.\n') {//sometimes if repo is empty or at first commit
          app.log.warn('The Repo might be empty or at first commit... no master found...'.red);
          return cb(null, 'DONE');
        } else {
          return cb(error);
        }
      } else {
        if (stderr === 'fatal: A branch named \'clean\' already exists.\n') {
          app.log.warn('A branch named \'clean\' ' + 'already exists'.red.bold + ' @' + repoLocation.yellow.bold);
        } else {
          app.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'created'.green);
        }
        app.log.debug('calling: "' + cmd2.grey + '"');
        var child2 = exec(cmd2,
          function (error, stdout, stderr) {
            if (error !== null) {
              app.log.warn('switchBranch::2: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
              console.dir(error);
              console.dir(stdout);
              console.dir(stderr);
              return cb(error);
            } else {
              app.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'checked out'.green.bold);
              return cb(null, 'OK');
            }
          });
      }
    });
}

function commitRepo(link, forkedRepo, repoLocation, status, cb) {

  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  var gitDir, cmd, child, message;
  message = "[fix] Changed require('sys') to require('util') for compatibility with node v0.8";
  gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
  app.log.info("Attempting a commit on " +  repoLocation.blue.bold);
  cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" commit -am "' + message + '"';
  app.log.debug('calling: "' + cmd.grey + '"');
  child = exec(cmd,
    function (error, stdout, stderr) {
      if (error !== null) {
        app.log.warn('commitRepo: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
        console.dir(error);
        console.dir(stdout);
        console.dir(stderr);
        if (stdout === '# On branch clean\nnothing to commit (working directory clean)\n') {
          app.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'NOTHING TO COMMIT'.red.bold);
          redisClient.hset(npm_hash, link, 'processed');
          return cb(null, 'DONE');
        } else {
          return cb(error);
        }
      } else {
        app.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'COMMIT'.green.bold);
        return cb(null, 'OK');
      }
    });
}

function pushCommit(forkedRepo, repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  var gitDir, cmd, child;
  gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
  app.log.info("Attempting a push commit on branch clean @" +  repoLocation.blue.bold);
  cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" push origin clean';
  app.log.debug('calling: "' + cmd.grey + '"');
  child = exec(cmd,
    function (error, stdout, stderr) {
      if (error !== null) {
        app.log.warn('pushCommit: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
        console.dir(error);
        console.dir(stdout);
        console.dir(stderr);

        if (stdout === 'To prevent you from losing history, non-fast-forward updates were rejected\nMerge the remote changes before pushing again.  See the \'Note about\nfast-forwards\' section of \'git push --help\' for details.\n') {
          app.log.warn(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'COMMIT NOT PUSHED'.red.bold + ' : We may have already pushed to this fork!'.magenta.bold);
          return cb(null, 'OK');
        } else {
          return cb(error);
        }
      } else {
        app.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'COMMIT PUSHED'.green.bold);
        return cb(null, 'OK');
      }
    });
}

function notifyAvailability(forkedRepo, username, repo, repoLocation, status, cb) {
  var count    = 0,
      Available = false;
  async.until(// wait for availability (whilst)
      function () {
        if (count % 2 === 0) {
          app.log.info('Waiting for ' + username.magenta.bold + '/' + repo.yellow.bold + ' to become available...');
        }
        request.head(forkedRepo, function (error, response, body) {
          app.log.debug('notifyAvailability :: forkedRepo = ' + forkedRepo + ' | ' + 'response.statusCode = ' + response.statusCode);
          if (!error && response.statusCode === 200) {
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
          if (count > 300) {
            app.log.error('Unable to find forked repo ' + username.magenta.bold + '/' + repo.yellow.bold + ' after 5 minutes.');

          } else {
            app.log.info('Forked repo ' + username.magenta.bold + '/' + repo.yellow.bold + ' Exists!');
            if (Available) {
              return cb(null, 'OK');//Change to 'DONE' if you dont want to clone
            } else {
              return cb("error: Timeout");
            }
          }
        }
    );
}

function walkAndFix(link, repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  walk(repoLocation, function (err, results) {
      if (err) {
        return cb(err);
      }

      async.map(results, doFileUpdate, function (err, results) {
        if (err) {
          return cb(err);
        }
        //app.log.debug(results);
        //app.log.debug(results.indexOf('OK'));
        if (results.indexOf('OK') === -1) {
          app.log.warn('No changes to make for '.bold.red + repoLocation.yellow);
          redisClient.hset(npm_hash, link, 'processed');
          return cb(null, 'DONE');
        } else {
          return cb(null, 'OK');
        }
      });

    });
}

function isNotOK(element, index, array) {
  return (element !== 'OK');
}

function filterString(str) {
  var re = /^(\w*((\.js)|(\.txt)|(\.md)|(\.markdown))?|readme.*)$/gi;
  // only choose folders and no ext files, *.js, *.txt, *.md, *.markdown, and readme files
  return XRegExp.test(str, re);
}

function walk(dir, done) {
  var results = [];
  fs.readdir(dir, function (err, list) {
    var pending, modList;
    if (err) { return done(err); }

    modList = list.filter(filterString);//filter out the undesirables
    list = modList;
    pending = list.length;
    if (!pending) { return done(null, results); }
    list.forEach(function (file) {
      file = path.resolve(path.join(dir, file));
      fs.stat(file, function (err, stat) {
        if (stat && stat.isDirectory()) {
          walk(file, function (err, res) {
            results = results.concat(res);
            if (!--pending) { done(null, results); }
          });
        } else {
          results.push(file);
          if (!--pending) { done(null, results); }
        }
      });
    });
  });
}

function doFileUpdate(filename, cb) {
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
        dataStr = data.toString(),
        fixedDoc = '';

    if (XRegExp.test(dataStr, re)) {
      if (XRegExp.test(dataStr, reFull)) {
        fixedDoc = XRegExp.replace(XRegExp.replace(dataStr, rePart, replacementPart, 'all'), reFull, replacementFull, 'all');
      }
      else {
        fixedDoc = XRegExp.replace(dataStr, re, replacement, 'all');
      }
      //return cb(null, fixedDoc);
      // write changes out to file
      fs.writeFile(filename, fixedDoc, function (err) {
          if (err) {
            app.log.error('The file was not saved');
            return cb(err);
          } else {
            app.log.info(filename.blue.bold + ' was modified and changed!');
            return cb(null, 'OK');
          }
        });

    } else {
      app.log.debug('No ' + 'require("sys")'.magenta.bold + ' text found in ' + filename.blue.bold);
      return cb(null, 'NO CHANGE');
    }
  });
}
