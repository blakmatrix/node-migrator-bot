exports.attach = function (options) {

  var path   = require('path'),
    XRegExp  = require('xregexp').XRegExp,
    fs       = require('fs'),
    async    = require('async'),
    request  = require('request'),
    github   = require('octonode'),
    rimraf   = require('rimraf'),
    exec     = require('child_process').exec,
    github_token_id = '',
    github_token    = '',
    github_token_ct = -1,
    self = this,
    gitQue = async.queue(function (task, callback) {
      self.log.debug('GITQUE:'.cyan.bold + ' Running '.green.bold + task["info"].toString().magenta);
      callback(null, task);
    }, 1),


  getDBinfo = this.getDBinfo = function (cb) {
    options.dbGetInfo(cb);
  },

  doNPMUpdate = this.doNPMUpdate = function (cb) {
    getNPMRepos(function (err, results) {
      self.log.debug(results);
      async.forEachSeries(results.filter(function (x) { return typeof x !== 'undefined' && x !== null; }), doRepoUpdate, function (err) {
        if (err) {
          self.log.warn('Error processing npm repositories that are hosted on github!!!'.red.bold);
          return cb(err);
        } else {
          return cb(null, 'OK');
        }
      });
    });
  },

  getNPMRepos = this.getNPMRepos = function (cb) {
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
  },

  getNPMRepoLocation = this.getNPMRepoLocation = function (id_obj, cb) {
    request('http://isaacs.couch.xxx/registry/' + id_obj.id, function (err, res, npmPackage) {
      if (err) {
        return cb(err);
      }
      if (JSON.parse(npmPackage).repository && JSON.parse(npmPackage).repository.url) {
        return cb(null, JSON.parse(npmPackage).repository.url);
      } else {
        self.log.debug('No Repo for ' + id_obj.id);
        cb(null);
      }

    });
  },



  doUserRepoUpdateStart = this.doUserRepoUpdateStart = function (user, cb) {
    var client   = github.client();
    self.log.info('Getting ' + user.red.bold + '\'s list of Repositories...');
    client.get('/users/' + user + '/repos', function (err, status, data) {
        if (err) {
          self.log.error('error:  ' + err);
          self.log.error('status: ' + status);
          self.log.error('data:   ' + data);
          return cb(err);
        } else {
          async.forEach(data, doUserRepoUpdate, cb);
        }
      });
  },

  doUserRepoUpdate = this.doUserRepoUpdate = function (repoData, cb) {
    doRepoUpdate(repoData["html_url"], cb);
  },

  doRepoUpdate = this.doRepoUpdate = function (link, cb) {
    var re = /(http|ftp|https|git|file):\/\/(\/)?[\w\-]+(\.[\w\-]+)+([\w.,@?\^=%&amp;:\/~+#\-]*[\w@?\^=%&amp;\/~+#\-])?/gi,
     reSSH = /git@github\.com:.*\/.*(\.git$|$)/g;

    options.dbCheck(link, function (err, hashk_value) {
      if (err) {
        self.log.error('There was a problem with finding the value of: ' + link);
        //return cb(err);
        return cb(null, 'DONE');
      }

      if (hashk_value === null) {
        if (XRegExp.test(link, re) || XRegExp.test(link, reSSH)) {
          self.log.info(link.blue.bold + ' is a url');
          forkAndFix(link, cb);
        } else {
          self.log.info(link.blue.bold + ' is a folder');
          walkAndFix(null, link, 'OK', cb);//NOTE: LINK HERE IS the path!!!
        }
      } else {
        self.log.info(link.yellow.bold + ' Has already been processed!');
        return cb(null, "DONE");
      }
    });
  },

  forkAndFix = this.forkAndFix = function (link, cb) {
    var parse        = XRegExp(/.*github.com[\/|:]([\w|\-]+)\/([\w|\-|\.]+)(\.git$|[\/]$|$)/g),
        user         = XRegExp.replace(link, parse, '$1'),
        repo_pre     = XRegExp.replace(link, parse, '$2'),
        repo         = repo_pre.replace('.git', ''),
        forkedRepo   = 'https://github.com/' + options.username + '/' + repo,
        tmpDir       = path.resolve(path.join('.', 'tmp')),
        repoLocation = path.resolve(path.join(path.join(tmpDir, user), repo)).toString();

    async.waterfall([
      //function (callback) {
        //watchRepo(user, repo, callback);
      //},//watch repo
      function (callback) {checkGithubToken('OK', callback); },
      function (status, callback) {
        self.log.info('');
        self.log.info('');
        self.log.info('');
        self.log.info('');
        self.log.info('^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^'.cyan);
        self.log.info('Starting new Clone ' + user.magenta.bold + '/' + repo.yellow.bold);
        self.log.info('vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'.cyan);
        self.log.info('');
        self.log.info('');
        self.log.info('');
        self.log.info('');
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
        forkRepo(link, forkedRepo, options.username, user, repo, repoLocation, status, callback);
      },//fork
      function (status, callback) {
        notifyAvailability(forkedRepo, options.username, repo, repoLocation, status, callback);
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
        submitPullRequest(link, options.username, user, repo, status, callback);
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
        self.log.info(options.botname.grey + ' Done with '.green + link.blue.bold + ' RESULT: '.grey + result);
        return cb(null, result);
      });
  },

  cleanUpFileSystem = this.cleanUpFileSystem = function (repoLocation, cb) {
    path.exists(repoLocation, function (exists) {//if exists
      if (exists) {
        rimraf(repoLocation, function (err) {
          if (err) {
            self.log.error('ERROR Removing Repository directory : '.red.bold + repoLocation.yellow.bold);
            //return cb(err);
            return cb(null, 'DONE');
          }
          self.log.info('Removed Repository directory : ' + repoLocation.yellow.bold);
          return cb(null, 'DONE');
        });
      } else {
        self.log.warn('ERROR Repository directory does not exist : '.red.bold + repoLocation.yellow.bold);
        return cb(null, 'DONE');
      }
    });
  },

  forkRepo = this.forkRepo = function (link, forkedRepo, username, user, repo, repoLocation, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    self.log.info('Forking ' + user.magenta.bold + '/' + repo.yellow.bold);
    var client   = github.client(github_token);
    github_token_ct -= 1;
    self.log.info('');
    self.log.info('');
    self.log.info('forkRepo');
    self.log.info('============================================================================'.green.inverse);
    self.log.info('link, forkedRepo, options.username, user, repo, repoLocation');
    self.log.info('============================================================================'.green.inverse);
    self.log.info(link + ' | ' + forkedRepo + ' | ' + options.username + ' | ' + user + ' | ' + repo + ' | ' + repoLocation);
    self.log.info('');
    self.log.info('');

    client.me().fork(user + '/' + repo, function (err, data) {
      if (err) {
        self.log.error(err + ' ' + link.yellow.bold);
        self.log.debug('data:  ' + data);
        self.log.debug(':user/:repo = ' + user + '/' + repo);
        if (err.toString().indexOf('Not Found') !== -1) {
          self.log.warn('Could not fork : ' + link.yellow.bold + ' NOT FOUND!'.red.bold);
          return cb(null, 'DONE');
        } else {
          //return cb(err);
          return cb(null, 'DONE');
        }
      } else {
        self.log.warn('Forked : ' + link.yellow.bold + ' SUCCESS!'.green.bold);
        return cb(null, 'OK');
      }
    });
  },

  submitPullRequest = this.submitPullRequest = function (link, username, user, repo, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }

    github_token_ct -= 1;
    var url = 'https://api.github.com/repos/' + user + '/' + repo + '/pulls?access_token=' + github_token,
        payload = JSON.stringify({
      "title": options.gitPullRequestMessageTitle,
      "body" : options.gitPullRequestMessage,
      "base" : "master",
      "head" : options.username + ":clean"
    });

    /*
    var client   = github.client(github_token);
    github_token_ct -= 1;

    client.repo(options.username + '/' + repo).create_pull_request_comment(
      'id', /// -> is this right?
      payload,
      function (err, data) {
        //TODO (if octonode ever implements)
      });*/
    self.log.debug('Attempting to make Pull Request to:\n' + url.green + ' with the following payload:\n\n ' + payload.cyan.bold);
    request.post({url: url, body: payload}, function (error, response, body) {
            if (!error && response.statusCode === 201) {//Status: 201 Created
              self.log.info('Pull Request to ' + user + '/' + repo + ' from ' + options.username + '/' + repo + ' Succesfull!');
              options.dbAdd(link);

              return cb(null, 'OK');
            } else {
              if (error === null) {
                try {
                  throw new Error(response.statusCode + ' ' + response.body.toString());
                }catch (err) {
                  self.log.error('submitPullRequest::error : ' + err);
                  return cb(null, 'DONE');
                }
              } else {
                //return cb(error);
                return cb(null, 'DONE');
              }
            }
          });
  },

  cloneRepo = this.cloneRepo = function (user, repo, link, forkedRepo, repoLocation, cb) {
    var cmd, child;
    self.log.info("Attempting to clone " +  forkedRepo.blue.bold);
    //cmd = 'git clone git@github.com:' + options.username + '/' + repo + '.git "' + repoLocation + '"';
    //clone the users repo... fork later and add new origin
    //cmd = 'git clone git@github.com:' + user + '/' + repo + '.git "' + repoLocation + '"';
    cmd = 'git clone git@github.com:' + user + '/' + repo + '.git "' + repoLocation + '" --no-hardlinks';
    self.log.debug('calling: "' + cmd.grey + '"');
    child = exec(cmd,
      function (error, stdout, stderr) {
        console.dir(error);
        console.dir(stdout);
        console.dir(stderr);
        if (error !== null) {
          self.log.warn('cloneRepo: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
          if (stderr.indexOf('already exists') !== -1) {
            self.log.warn(forkedRepo.blue.bold + ' FAILED cloned to '.red.bold + repoLocation.yellow.bold + ' : We may have already cloned this one!'.magenta.bold);
            return cb(null, 'OK'); //ok? should we assume it might not have been processed? Lets see where it goes... shouldn't hurt
          } else if (stderr.indexOf('not found') !== -1) {
            self.log.warn(forkedRepo.blue.bold + ' FAILED cloned to '.red.bold + repoLocation.yellow.bold + ' : NOT FOUND!'.magenta.bold);
            options.dbAdd(link);// sometimes a repository just apears to not exist.. moved or account removed?
            return cb(null, 'DONE');
          } else {
            //return cb(error);
            return cb(null, 'DONE');
          }
        } else {
          self.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + 'SUCCESFULLY CLONED!'.green.bold);
          return cb(null, 'OK');
        }
      });
  },

  switchBranch = this.switchBranch = function (forkedRepo, repoLocation, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    var gitDir, cmd1, cmd2, child;
    self.log.info("Attempting to switch branch on " +  repoLocation.blue.bold);
    gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
    cmd1 = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" branch clean';
    cmd2 = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" checkout clean';
    self.log.debug('calling: "' + cmd1.grey + '"');
    child = exec(cmd1,
      function (error, stdout, stderr) {
        if (error !== null && stderr !== 'fatal: A branch named \'clean\' already exists.\n') {
          self.log.warn('switchBranch::1: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
          console.dir(error);
          console.dir(stdout);
          console.dir(stderr);
          if (stderr === 'fatal: Not a valid object name: \'master\'.\n') {//sometimes if repo is empty or at first commit
            self.log.warn('The Repo might be empty or at first commit... no master found...'.red);
            return cb(null, 'DONE');
          } else {
            //return cb(error);
            return cb(null, 'DONE');
          }
        } else {
          if (stderr === 'fatal: A branch named \'clean\' already exists.\n') {
            self.log.warn('A branch named \'clean\' ' + 'already exists'.red.bold + ' @' + repoLocation.yellow.bold);
          } else {
            self.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'created'.green);
          }
          self.log.debug('calling: "' + cmd2.grey + '"');
          var child2 = exec(cmd2,
            function (error, stdout, stderr) {
              if (error !== null) {
                self.log.warn('switchBranch::2: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
                console.dir(error);
                console.dir(stdout);
                console.dir(stderr);
                //return cb(error);
                return cb(null, 'DONE');
              } else {
                self.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'checked out'.green.bold);
                return cb(null, 'OK');
              }
            });
        }
      });
  },

  commitRepo = this.commitRepo = function (link, forkedRepo, repoLocation, status, cb) {

    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    var gitDir, cmd, child, message;
    message = options.gitCommitMessage;
    gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
    self.log.info("Attempting a commit on " +  repoLocation.yellow.bold);
    cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" commit -am "' + message + '"';
    self.log.debug('calling: "' + cmd.grey + '"');
    child = exec(cmd,
      function (error, stdout, stderr) {
        if (error !== null) {
          self.log.warn('commitRepo: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
          console.dir(error);
          console.dir(stdout);
          console.dir(stderr);
          if (stdout === '# On branch clean\nnothing to commit (working directory clean)\n') {
            self.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'NOTHING TO COMMIT'.red.bold);
            options.dbAdd(link);
            return cb(null, 'DONE');
          } else {
            //return cb(error);
            return cb(null, 'DONE');
          }
        } else {
          self.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'COMMIT'.green.bold);
          return cb(null, 'OK');
        }
      });
  },

  pushCommit = this.pushCommit = function (forkedRepo, repoLocation, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    var gitDir, cmd, child;
    gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
    self.log.info("Attempting a push commit on branch clean @" +  repoLocation.yellow.bold);
    cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" push origin clean';
    self.log.debug('calling: "' + cmd.grey + '"');
    child = exec(cmd,
      function (error, stdout, stderr) {
        if (error !== null) {
          self.log.warn('pushCommit: ' + forkedRepo.blue.bold + ' ERROR DETECTED!'.red.bold);
          console.dir(error);
          console.dir(stdout);
          console.dir(stderr);

          if (stdout === 'To prevent you from losing history, non-fast-forward updates were rejected\nMerge the remote changes before pushing again.  See the \'Note about\nfast-forwards\' section of \'git push --help\' for details.\n') {
            self.log.warn(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'COMMIT NOT PUSHED'.red.bold + ' : We may have already pushed to this fork!'.magenta.bold);
            return cb(null, 'OK');
          } else {
            //return cb(error);
            return cb(null, 'DONE');
          }
        } else {
          self.log.info(forkedRepo.blue.bold + '@' + repoLocation.yellow.bold + ':clean branch ' + 'COMMIT PUSHED'.green.bold);
          return cb(null, 'OK');
        }
      });
  },

  remoteRename = this.remoteRename = function (repoLocation, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    var gitDir, cmd, child;
    gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
    self.log.info("Attempting a remote rename origin upstream @" +  repoLocation.yellow.bold);
    cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" remote rename origin upstream';
    self.log.debug('calling: "' + cmd.grey + '"');
    child = exec(cmd,
      function (error, stdout, stderr) {
        if (error !== null) {
          self.log.warn('');
          self.log.warn('');
          self.log.warn('################################################################################'.red.inverse);
          self.log.warn('remoteRename: ' + repoLocation.yellow.bold + ' ERROR DETECTED!'.red.bold);
          console.dir(error);
          console.dir(stdout);
          console.dir(stderr);
          self.log.warn('################################################################################'.red.inverse);
          self.log.warn('');
          self.log.warn('');


          return cb(null, 'DONE');

        } else {
          self.log.info(repoLocation.yellow.bold + 'remote rename origin upstream' + ' RENAME SUCCESS'.green.bold);
          return cb(null, 'OK');
        }
      });
  },

  remoteAddForkedOrigin = this.remoteAddForkedOrigin = function (repo, repoLocation, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    var gitDir, cmd, child;
    gitDir = path.resolve(path.join(repoLocation, '.git')).toString();
    self.log.info("Attempting a remote add forked origin @" +  repoLocation.yellow.bold);
    cmd = 'git --git-dir="' + gitDir + '" --work-tree="' + repoLocation  + '" remote add -f origin git@github.com:' + options.username + '/' + repo + '.git';
    self.log.debug('calling: "' + cmd.grey + '"');
    child = exec(cmd,
      function (error, stdout, stderr) {
        if (error !== null) {
          self.log.warn('');
          self.log.warn('');
          self.log.warn('################################################################################'.red.inverse);
          self.log.warn('remoteAddForkedOrigin: ' + repoLocation.yellow.bold + ' ERROR DETECTED!'.red.bold);
          console.dir(error);
          console.dir(stdout);
          console.dir(stderr);
          self.log.warn('################################################################################'.red.inverse);
          self.log.warn('');
          self.log.warn('');


          return cb(null, 'DONE');

        } else {
          self.log.info(repoLocation.yellow.bold + 'remote add -f origin' + ' FORKED ORIGIN ADDED'.green.bold);
          return cb(null, 'OK');
        }
      });
  },

  notifyAvailability = this.notifyAvailability = function (forkedRepo, username, repo, repoLocation, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    var count    = 0,
        Available = false;
    async.until(// wait for availability
        function () {
          if (count % 2 === 0) {
            self.log.info('Waiting for ' + options.username.magenta.bold + '/' + repo.yellow.bold + ' to become available...');
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
              self.log.error('Unable to find forked repo ' + options.username.magenta.bold + '/' + repo.yellow.bold + ' after 1 minutes.');

            } else {
              self.log.info('Forked repo ' + options.username.magenta.bold + '/' + repo.yellow.bold + ' Exists!');
              if (Available) {
                return cb(null, 'OK');//Change to 'DONE' if you dont want to clone
              } else {
                return cb(null, "error: Timeout");
              }
            }
          }
      );
  },

  waitAMinute = this.waitAMinute = function (status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    var count    = 0;
    async.until(// wait for availability
        function () {
          if (count % 2 === 0) {
            self.log.info('Waiting...');
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
  },

  walkAndFix = this.walkAndFix = function (link, repoLocation, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }
    walk(repoLocation, function (err, results) {
        if (err) {
          //return cb(err);
          return cb(null, 'DONE');
        }

        async.map(results, options.makeFileChanges, function (err, status) {
          if (err) {
            //return cb(err);
            return cb(null, 'DONE');
          }

          if (status.indexOf('OK') === -1) {
            self.log.warn('');
            self.log.warn('');
            self.log.warn('----------------------------------------------------------------------------------'.red);
            self.log.warn('No changes to make for '.bold.red + repoLocation.yellow);
            self.log.warn('----------------------------------------------------------------------------------'.red);
            self.log.warn('');
            self.log.warn('');
            options.dbAdd(link);
            return cb(null, 'DONE');
          } else {
            return cb(null, 'OK');
          }
        });

      });
  },

  isNotOK = this.isNotOK = function (element, index, array) {
    return (element !== 'OK');
  },



  walk = this.walk = function (dir, done) {
    var results = [];
    fs.readdir(dir, function (err, list) {
      var pending, modList;
      if (err) {
        return done(null, []);//err);
      }

      modList = list.filter(options.includeFilter);//filter out the desirables
      modList = modList.filter(options.excludeFilter);//filter out the undesirables
      list = modList;
      self.log.info(list);
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
  },

  deleteRepo = this.deleteRepo = function (repo, status, cb) {
    if (status === 'DONE') {

      var client = github.client(github_token),
          endpoint = '/repos/' + options.username + '/' + repo;
      github_token_ct -= 1;

      client.del(endpoint, {},  function (err, status, body) {
        console.dir(err);
        console.dir(status);
        console.dir(body);
        if (err) {
          self.log.error('Could not delete ' + endpoint.blue + ' : ' + body);
          //return cb({message: err + ' ' + endpoint});
          return cb(null, 'OK');
        }
        if (status === 204) { //Status: 204 No Content
          self.log.info('Succesfully deleted ' + endpoint.blue);
          return cb(null, 'OK');
        } else {
          self.log.warn('Could not delete ' + endpoint.blue + ' : ' + body);
          return cb(null, 'OK');
        }
      });
    } else {
      self.log.warn('Did not delete ' + repo.blue);
      cb(null, 'OK');
    }
  },

  deleteRepoIfExists = this.deleteRepoIfExists = function (repo, status, cb) {
    if (status === 'DONE') {
      return cb(null, 'DONE');
    }

    var client = github.client(github_token),
    endpoint = '/repos/' + options.username + '/' + repo;
    github_token_ct -= 1;

    client.get(endpoint, function (err, status, body) {
      if (err) {
        return cb(null, 'OK');
      } else {

        async.waterfall([
          function (callback) {
            self.log.warn('Endpoint ' + endpoint.blue + ' seems to already exist. Deleting...'.inverse.blue);
            deleteRepo(repo, 'DONE', callback);
          },
          function (status, callback) { waitAMinute('OK', callback); }
        ],
         function (err, result) {//callback
          if (err) {
            //return cb(err);
            return cb(null, 'DONE');
          }
          self.log.info('REFORKED '.green.inverse + endpoint.blue);
          return cb(null, 'OK');
        });
      }
    });

  },

  watchRepo = this.watchRepo = function (user, repo, cb) {
    var client = github.client(github_token),
    endpoint = '/user/watched' + user + '/' + repo;
    github_token_ct -= 1;

    client.put(endpoint, {},  function (err, status, body) {
      if (err) {
        self.log.error('Could not watch ' + endpoint.blue + ' : ' + body);
        //return cb({message: err + ' ' + endpoint});
        return cb(null, 'OK');
      }
      if (status === 204) { //Status: 204 No Content
        self.log.info('watching !' + endpoint.blue);
        return cb(null, 'OK');
      } else {
        self.log.error('Could not watch ' + endpoint.blue + ' : ' + body);
        return cb(null, 'OK');
      }
    });
  },



  setNewGithubToken = this.setNewGithubToken = function (status, cb) {
    github.auth.config({
      username: options.username,
      password: options.password
    }).login(['user', 'repo', 'delete_repo'], function (err, id, token) {
      if (err !== null) {
        self.log.error('Could not sign out a new token!');
        cb(err);
      } else {
        self.log.info('Succesfully signed out a new token! '.green.bold + github_token);
        github_token_id = id;
        github_token    = token;
        github_token_ct = 3000;
        cb(null, 'OK');
      }
    });
  },


  revokeGithubToken = this.revokeGithubToken = function (status, cb) {
    if (github_token_ct === -1) {//first setting
      self.log.info('Signing out our first token! '.green.bold);
      return cb(null, 'OK');
    }
    github.auth.config({
      username: options.username,
      password: options.password
    }).revoke(github_token_id, function (err) {
      if (err !== null) {
        self.log.error('Could not sign out a new token!');
        cb(err);
      } else {
        self.log.info('Succesfully revoked  token! '.green.bold + github_token);
        cb(null, 'OK');
      }
    });
  },

  checkGithubToken = this.checkGithubToken = function (status, cb) {
    self.log.info('Github token count at : ' + github_token_ct.toString());
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
  };

};

exports.init = function (done) {
  // This plugin doesn't require any initialization step.
  return done();
};