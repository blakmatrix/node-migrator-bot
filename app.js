#!/usr/bin/env node

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
    botname  = app.config.get('bot-name'),
    port     = app.config.get('database:port'),
    host     = app.config.get('database:host'),
    pass     = app.config.get('database:password'),
    npm_hash = app.config.get('database:npm_hash'),
    github_token_id = '',
    github_token    = '',
    github_token_ct = -1;

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
    '    node-migrator-bot file <file>   - runs the bot on the file provided',
    '    node-migrator-bot npm           - runs the bot on npm packages with repos on ',
    '                                      github',
    '    node-migrator-bot db            - displays all the processed repos in the db',
    '    node-migrator-bot use           - You\'re looking at it!'
  ]
});

app.commands.repo = function repo(link, cb) {
  this.log.info('Attempting to open path"' + link + '"');
  doRepoUpdate(link, cb);
};

app.commands.delrepo = function delRepo(repo, cb) {
  this.log.info('Attempting to open delete "' + username + '/' + repo + '"');
  deleteRepo(repo, 'DONE', cb);
};

app.commands.db = function db(cb) {
  this.log.info('Getting processed items in DB...');
  getDBinfo(cb);
};

app.commands.npm = function npm(link, cb) {
  this.log.warn('Running on all available npm repositories that are hosted on github!!!'.red.bold);
  doNPMUpdate(cb);
};

app.commands.user = function user(user, cb) {
  this.log.info('Attempting get information on "' + user + '"');
  doUserRepoUpdateStart(user, cb);
};

app.commands.file = function file(filename, cb) {
  this.log.info('Attempting to open "' + filename + '"');
  doFileUpdate(filename, cb);
};







function getDBinfo(cb) {
  redisClient.hgetall(npm_hash, function (err, data) {
    console.dir(data);
    //app.log.info(data);
    cb(null);

  });
}

function doNPMUpdate(cb) {
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
      //return cb(err);
      return cb(null, 'DONE');
    }

    if (hashk_value === null) {
      if (XRegExp.test(link, re) || XRegExp.test(link, reSSH)) {
        app.log.info(link.blue.bold + ' is a url');
        forkAndFix(link, cb);
      } else {
        app.log.info(link.blue.bold + ' is a folder');
        walkAndFix(null, link, 'OK', cb);//NOTE: LINK HERE IS the path!!!
      }
    } else {
      app.log.info(link.yellow.bold + ' Has already been processed!');
      return cb(null, "DONE");
    }
  });
}

function forkAndFix(link, cb) {
  var parse        = XRegExp(/.*github.com[\/|:]([\w|\-]+)\/([\w|\-|\.]+)(\.git$|[\/]$|$)/g),
      user         = XRegExp.replace(link, parse, '$1'),
      repo_pre     = XRegExp.replace(link, parse, '$2'),
      repo         = repo_pre.replace('.git', ''),
      forkedRepo   = 'https://github.com/' + username + '/' + repo,
      tmpDir       = path.resolve(path.join('.', 'tmp')),
      repoLocation = path.resolve(path.join(path.join(tmpDir, user), repo)).toString();

  async.waterfall([
    //function (callback) {
      //watchRepo(user, repo, callback);
    //},//watch repo
    function (callback) {checkGithubToken('OK', callback); },
    function (status, callback) {
      app.log.info('');
      app.log.info('');
      app.log.info('');
      app.log.info('');
      app.log.info('^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^'.cyan);
      app.log.info('Starting new Clone ' + user.magenta.bold + '/' + repo.yellow.bold);
      app.log.info('vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'.cyan);
      app.log.info('');
      app.log.info('');
      app.log.info('');
      app.log.info('');
      gitQue.push({task: cloneRepo(user, repo, link, forkedRepo, repoLocation, callback), info: '   git:cloneRepo :: ' + forkedRepo});
    },// clone repo
    function (status, callback) {
      gitQue.push({task: switchBranch(forkedRepo, repoLocation, status, callback), info: 'git:switchBranch :: ' + forkedRepo});
    },// switch branch
    function (status, callback) {
      walkAndFix(link, repoLocation, status, callback);
    },// walkAndFix
    function (status, callback) {
      gitQue.push({task:  remoteRename(repoLocation, status, callback), info: '  git:remoteRename :: ' + forkedRepo});
    },// rename origin upstream
    function (status, callback) {
      deleteRepoIfExists(repo, status, callback);
    }, // delete a repo if it already exists
    function (status, callback) { //We will now fork if there were changes
      forkRepo(link, forkedRepo, username, user, repo, repoLocation, status, callback);
    },//fork
    function (status, callback) {
      notifyAvailability(forkedRepo, username, repo, repoLocation, status, callback);
    },// wait for availability
    function (status, callback) {
      gitQue.push({task:  remoteAddForkedOrigin(repo, repoLocation, status, callback), info: '  git:remoteAddForkedOrigin :: ' + forkedRepo});
    },// rename origin upstream
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
      deleteRepo(repo, status, callback);
    },// delete forked repo if there is not a pull request to make
    function (status, callback) {
      cleanUpFileSystem(repoLocation, callback);
    }//clean up filesystem
  ],
    function (err, result) {//callback
      if (err) {
        //return cb(err);
        return cb(null, 'DONE');
      }
      app.log.info(botname.grey + ' Done with '.green + link.blue.bold + ' RESULT: '.grey + result);
      return cb(null, result);
    });
}

function cleanUpFileSystem(repoLocation, cb) {
  path.exists(repoLocation, function (exists) {//if exists
    if (exists) {
      rimraf(repoLocation, function (err) {
        if (err) {
          app.log.error('ERROR Removing Repository directory : '.red.bold + repoLocation.yellow.bold);
          //return cb(err);
          return cb(null, 'DONE');
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

function forkRepo(link, forkedRepo, username, user, repo, repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  app.log.info('Forking ' + user.magenta.bold + '/' + repo.yellow.bold);
  var client   = github.client(github_token);
  github_token_ct -= 1;
  app.log.info('');
  app.log.info('');
  app.log.info('forkRepo');
  app.log.info('============================================================================'.green.inverse);
  app.log.info('link, forkedRepo, username, user, repo, repoLocation');
  app.log.info('============================================================================'.green.inverse);
  app.log.info(link + ' | ' + forkedRepo + ' | ' + username + ' | ' + user + ' | ' + repo + ' | ' + repoLocation);
  app.log.info('');
  app.log.info('');

  client.me().fork(user + '/' + repo, function (err, data) {
    if (err) {
      app.log.error(err + ' ' + link.yellow.bold);
      app.log.debug('data:  ' + data);
      app.log.debug(':user/:repo = ' + user + '/' + repo);
      if (err.toString().indexOf('Not Found') !== -1) {
        app.log.warn('Could not fork : ' + link.yellow.bold + ' NOT FOUND!'.red.bold);
        return cb(null, 'DONE');
      } else {
        //return cb(err);
        return cb(null, 'DONE');
      }
    } else {
      app.log.warn('Forked : ' + link.yellow.bold + ' SUCCESS!'.green.bold);
      return cb(null, 'OK');
    }
  });
}

function submitPullRequest(link, username, user, repo, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }

  github_token_ct -= 1;
  var url = 'https://api.github.com/repos/' + user + '/' + repo + '/pulls?access_token=' + github_token,
      bodyMessage = [
    'Hello ' + user + '!',
    '',
    '',
    'I am ' + botname + ', an '
    + '[open-source](https://github.com/blakmatrix/node-migrator-bot) bot, '
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
    + '1582cfebd6719b2d2373547994b3dca5c8c569c0/ChangeLog#L51 and '
    + 'http://blog.jit.su/introducing-blakmatrix-and-migratorbot .',
    '',
    'As for myself, I was written by your friendly neighborhood node ninjas '
    + 'at [Nodejitsu](http://nodejitsu.com), and you can find them at '
    + '#nodejitsu on irc.freenode.net or with http://webchat.jit.su .',
    '',
    'Enjoy!',
    '',
    '--'
    + '[' + botname + '](https://github.com/blakmatrix/node-migrator-bot)'
  ].join('\n'),
      payload = JSON.stringify({
    "title": "Hi! I fixed some calls to \"sys\" for you!",
    "body": bodyMessage,
    "base": "master",
    "head": username + ":clean"
  });

  /*
  var client   = github.client(github_token);
  github_token_ct -= 1;

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

            return cb(null, 'OK');
          } else {
            if (error === null) {
              try {
                throw new Error(response.statusCode + ' ' + response.body.toString());
              }catch (err) {
                app.log.error('submitPullRequest::error : ' + err);
                return cb(null, 'DONE');
              }
            } else {
              //return cb(error);
              return cb(null, 'DONE');
            }
          }
        });
  
}

function cloneRepo(user, repo, link, forkedRepo, repoLocation, cb) {
  var cmd, child;
  app.log.info("Attempting to clone " +  forkedRepo.blue.bold);
  //cmd = 'git clone git@github.com:' + username + '/' + repo + '.git "' + repoLocation + '"';
  //clone the users repo... fork later and add new origin
  //cmd = 'git clone git@github.com:' + user + '/' + repo + '.git "' + repoLocation + '"';
  cmd = 'git clone git@github.com:' + user + '/' + repo + '.git "' + repoLocation + '" --no-hardlinks --recursive';
  app.log.debug('calling: "' + cmd.grey + '"');
  child = exec(cmd,
    function (error, stdout, stderr) {
      console.dir(error);
      console.dir(stdout);
      console.dir(stderr);
      if (error !== null) {
        app.log.warn('cloneRepo: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
        if (stderr.indexOf('already exists') !== -1) {
          app.log.warn(forkedRepo.blue.bold + ' FAILED cloned to '.red.bold + repoLocation.yellow.bold + ' : We may have already cloned this one!'.magenta.bold);
          return cb(null, 'OK'); //ok? should we assume it might not have been processed? Lets see where it goes... shouldn't hurt
        } else if (stderr.indexOf('not found') !== -1) {
          app.log.warn(forkedRepo.blue.bold + ' FAILED cloned to '.red.bold + repoLocation.yellow.bold + ' : NOT FOUND!'.magenta.bold);
          redisClient.hset(npm_hash, link, 'processed');// sometimes a repository just apears to not exist.. moved or account removed?
          return cb(null, 'DONE');
        } else {
          //return cb(error);
          return cb(null, 'DONE');
        }
      } else {
        app.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold) + 'SUCCESFULLY CLONED!'.green.bold;
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
          //return cb(error);
          return cb(null, 'DONE');
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
              //return cb(error);
              return cb(null, 'DONE');
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
  message = "[fix] Changed require('util') to require('util') for compatibility with node v0.8";
  gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
  app.log.info("Attempting a commit on " +  repoLocation.yellow.bold);
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
          //return cb(error);
          return cb(null, 'DONE');
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
  app.log.info("Attempting a push commit on branch clean @" +  repoLocation.yellow.bold);
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
          //return cb(error);
          return cb(null, 'DONE');
        }
      } else {
        app.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'COMMIT PUSHED'.green.bold);
        return cb(null, 'OK');
      }
    });
}

function remoteRename(repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  var gitDir, cmd, child;
  gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
  app.log.info("Attempting a remote rename origin upstream @" +  repoLocation.yellow.bold);
  cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" remote rename origin upstream';
  app.log.debug('calling: "' + cmd.grey + '"');
  child = exec(cmd,
    function (error, stdout, stderr) {
      if (error !== null) {
        app.log.warn('');
        app.log.warn('');
        app.log.warn('################################################################################'.red.inverse);
        app.log.warn('remoteRename: ' + repoLocation.yellow.bold + ' ERROR DETECTED!'.red.bold);
        console.dir(error);
        console.dir(stdout);
        console.dir(stderr);
        app.log.warn('################################################################################'.red.inverse);
        app.log.warn('');
        app.log.warn('');


        return cb(null, 'DONE');

      } else {
        app.log.info(repoLocation.yellow.bold + 'remote rename origin upstream' + ' RENAME SUCCESS'.green.bold);
        return cb(null, 'OK');
      }
    });
}

function remoteAddForkedOrigin(repo, repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  var gitDir, cmd, child;
  gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
  app.log.info("Attempting a remote add forked origin @" +  repoLocation.yellow.bold);
  cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" remote add -f origin git@github.com:' + username + '/' + repo + '.git';
  app.log.debug('calling: "' + cmd.grey + '"');
  child = exec(cmd,
    function (error, stdout, stderr) {
      if (error !== null) {
        app.log.warn('');
        app.log.warn('');
        app.log.warn('################################################################################'.red.inverse);
        app.log.warn('remoteAddForkedOrigin: ' + repoLocation.yellow.bold + ' ERROR DETECTED!'.red.bold);
        console.dir(error);
        console.dir(stdout);
        console.dir(stderr);
        app.log.warn('################################################################################'.red.inverse);
        app.log.warn('');
        app.log.warn('');


        return cb(null, 'DONE');

      } else {
        app.log.info(repoLocation.yellow.bold + 'remote add -f origin' + ' FORKED ORIGIN ADDED'.green.bold);
        return cb(null, 'OK');
      }
    });
}

function notifyAvailability(forkedRepo, username, repo, repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  var count    = 0,
      Available = false;
  async.until(// wait for availability
      function () {
        if (count % 2 === 0) {
          app.log.info('Waiting for ' + username.magenta.bold + '/' + repo.yellow.bold + ' to become available...');
        }
        request.head(forkedRepo, function (error, response, body) {
          if (!error && response.statusCode === 200) {
            Available = true;
          }
        });
        return count > 30 || Available;
      },
        function (cb) {
          count++;
          setTimeout(cb, 2000);
        },
      function (err) {
          // 5 minutes have passed
          if (count > 300) {
            app.log.error('Unable to find forked repo ' + username.magenta.bold + '/' + repo.yellow.bold + ' after 1 minutes.');

          } else {
            app.log.info('Forked repo ' + username.magenta.bold + '/' + repo.yellow.bold + ' Exists!');
            if (Available) {
              return cb(null, 'OK');//Change to 'DONE' if you dont want to clone
            } else {
              return cb(null,"error: Timeout");
            }
          }
        }
    );
}

function waitAMinute(status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  var count    = 0;
  async.until(// wait for availability
      function () {
        if (count % 2 === 0) {
          app.log.info('Waiting...');
        }

        return count > 30;
      },
        function (cb) {
          count++;
          setTimeout(cb, 2000);
        },
      function (err) {
          // 1 minutes have passed

          return cb(null, 'OK');
        }

    );
}

function walkAndFix(link, repoLocation, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }
  walk(repoLocation, function (err, results) {
      if (err) {
        //return cb(err);
        return cb(null, 'DONE');
      }

      async.map(results, doFileUpdate, function (err, status) {
        if (err) {
          //return cb(err);
          return cb(null, 'DONE');
        }

        if (status.indexOf('OK') === -1) {
          app.log.warn('');
          app.log.warn('');
          app.log.warn('----------------------------------------------------------------------------------'.red);
          app.log.warn('No changes to make for '.bold.red + repoLocation.yellow);
          app.log.warn('----------------------------------------------------------------------------------'.red);
          app.log.warn('');
          app.log.warn('');
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

function filterGoodString(str) {
  var re = /^(\w*((\.js)|(\.txt)|(\.md)|(\.markdown))?|readme.*)$/gi;
  // only choose folders and no ext files, *.js, *.txt, *.md, *.markdown, and readme files
  return XRegExp.test(str, re);
}

function filterBadString(str) {
  var re = /^(node_modules|\.git|)$/gi;
  // only choose folders and no ext files, *.js, *.txt, *.md, *.markdown, and readme files
  return !(XRegExp.test(str, re));
}

function walk(dir, done) {
  var results = [];
  fs.readdir(dir, function (err, list) {
    var pending, modList;
    if (err) {
      return done(null, []);//err);
    }

    modList = list.filter(filterGoodString);//filter out the desirables
    modList = modList.filter(filterBadString);//filter out the desirables
    list = modList;
    app.log.info(list);
    pending = list.length;
    if (!pending) { return done(null, results); }
    list.forEach(function (file) {
      file = path.resolve(path.join(dir, file));
      fs.lstat(file, function (err, stat) {
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

function deleteRepo(repo, status, cb) {
  if (status === 'DONE') {

    var client = github.client(github_token),
        endpoint = '/repos/' + username + '/' + repo;
    github_token_ct -= 1;

    client.del(endpoint, {},  function (err, status, body) {
      console.dir(err);
      console.dir(status);
      console.dir(body);
      if (err) {
        app.log.error('Could not delete ' + endpoint.blue + ' : ' + body);
        //return cb({message: err + ' ' + endpoint});
        return cb(null, 'OK');
      }
      if (status === 204) { //Status: 204 No Content
        app.log.info('Succesfully deleted ' + endpoint.blue);
        return cb(null, 'OK');
      } else {
        app.log.warn('Could not delete ' + endpoint.blue + ' : ' + body);
        return cb(null, 'OK');
      }
    });
  } else {
    app.log.warn('Did not delete ' + repo.blue);
    cb(null, 'OK');
  }
}

function deleteRepoIfExists(repo, status, cb) {
  if (status === 'DONE') {
    return cb(null, 'DONE');
  }

  var client = github.client(github_token),
  endpoint = '/repos/' + username + '/' + repo;
  github_token_ct -= 1;

  client.get(endpoint, function (err, status, body) {
    if (err) {
      return cb(null, 'OK');
    } else {

      async.waterfall([
        function (callback) {
          app.log.warn('Endpoint ' + endpoint.blue + ' seems to already exist. Deleting...'.inverse.blue);
          deleteRepo(repo, 'DONE', callback);
        },
        function (status, callback) { waitAMinute('OK', callback); }
      ],
       function (err, result) {//callback
        if (err) {
          //return cb(err);
          return cb(null, 'DONE');
        }
        app.log.info('REFORKED '.green.inverse + endpoint.blue);
        return cb(null, 'OK');
      });
    }
  });

}

function watchRepo(user, repo, cb) {
  var client = github.client(github_token),
  endpoint = '/user/watched' + user + '/' + repo;
  github_token_ct -= 1;

  client.put(endpoint, {},  function (err, status, body) {
    if (err) {
      app.log.error('Could not watch ' + endpoint.blue + ' : ' + body);
      //return cb({message: err + ' ' + endpoint});
      return cb(null, 'OK');
    }
    if (status === 204) { //Status: 204 No Content
      app.log.info('watching !' + endpoint.blue);
      return cb(null, 'OK');
    } else {
      app.log.error('Could not watch ' + endpoint.blue + ' : ' + body);
      return cb(null, 'OK');
    }
  });
}

function doFileUpdate(filename, cb) {
  fs.readFile(filename, function (err, data) {
    if (err) {
      //return cb(err);
      return cb(null, 'DONE');
    }


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
      // write changes out to file
      fs.writeFile(filename, fixedDoc, function (err) {
          if (err) {
            app.log.error('The file was not saved');
            //return cb(err);
            return cb(null, 'DONE');
          } else {
            app.log.info(filename.yellow.bold + ' was modified and changed!'.inverse.green);
            return cb(null, 'OK');
          }
        });

    } else {
      app.log.debug('No ' + 'require(\'util\')'.magenta.bold + ' text found in ' + filename.yellow.bold);
      return cb(null, 'DONE');
    }
  });
}

function setNewGithubToken(status, cb) {
  github.auth.config({
    username: username,
    password: password
  }).login(['user', 'repo', 'delete_repo'], function (err, id, token) {
    if (err !== null) {
      app.log.error('Could not sign out a new token!');
      cb(err);
    } else {
      app.log.info('Succesfully signed out a new token! '.green.bold + github_token);
      github_token_id = id;
      github_token    = token;
      github_token_ct = 3000;
      cb(null, 'OK');
    }
  });
}


function revokeGithubToken(status, cb) {
  if (github_token_ct === -1) {//first setting
    app.log.info('Signing out our first token! '.green.bold);
    return cb(null, 'OK');
  }
  github.auth.config({
    username: username,
    password: password
  }).revoke(github_token_id, function (err) {
    if (err !== null) {
      app.log.error('Could not sign out a new token!');
      cb(err);
    } else {
      app.log.info('Succesfully revoked  token! '.green.bold + github_token);
      cb(null, 'OK');
    }
  });
}

function checkGithubToken(status, cb) {
  app.log.info('Github token count at : ' + github_token_ct.toString());
  if (github_token_ct < 100) {
    async.waterfall([
      function (callback) {revokeGithubToken('OK', callback); },
      function (status, callback) {setNewGithubToken('OK', callback); }
    ],
      function (err, result) {
        if (err) {
          return cb(err);
        } else {
          return cb(null, 'OK');
        }
      });

  } else {
    cb(null, 'OK');
  }
}



app.start(function (err) {
  if (err) {
    app.log.error(err.message || 'You didn\'t call any commands! Type <app> use to see use cases');
    app.log.warn(botname.grey + ' NOT OK.');
    redisClient.quit();
    return process.exit(1);
  }
  redisClient.quit();
  app.log.info(botname.grey + ' ok'.green.bold);
});