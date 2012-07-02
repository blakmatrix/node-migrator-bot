#!/usr/bin/env node

var flatiron   = require('flatiron'),
    XRegExp    = require('xregexp').XRegExp,
    fs         = require('fs'),
    path       = require('path'),
    redis      = require('redis'),
    //broadway   = require('broadway'),
    app        = flatiron.app,
    botOptions = {};

app.config.file({ file: path.join(__dirname, 'config', 'config.json') });

var username = botOptions.username = app.config.get('username'),
    password = botOptions.password = app.config.get('password'),
    botname  = botOptions.botname  = app.config.get('bot-name'),
    port     =                       app.config.get('database:port'),
    host     =                       app.config.get('database:host'),
    pass     =                       app.config.get('database:password'),
    npm_hash = app.config.get('database:npm_hash'),
    totalNPMPackages       = null,
    totalRepositories      = 0,
    totalRepositoryMatches = 0,
    repositoryMatchesList  = [];

var redisClient = redis.createClient(port, host);

redisClient.auth(pass, function (err) {
  if (err) {
    throw err;
  }
  app.log.info("REDIS Authed!");
});

redisClient.on("error", function (err) {
  app.log.error("REDIS " + err.message);
  //return process.exit(1);
});

// ========================================= Settings =========================
var gitCommitMessage           = botOptions.gitCommitMessage           = '[fix] Changed require(\'sys\') to require(\'util\') for compatibility with node v0.8',
    gitPullRequestMessageTitle = botOptions.gitPullRequestMessageTitle = "Hi! I fixed some calls to \"sys\" for you!",
    gitPullRequestMessage      = botOptions.gitPullRequestMessage      = [
    'Hai!',
    '',
    '',
    'I am ' + botname,
    '',
    'Did you know that the "sys" module throws an error if your program '
    + 'tries to require it in node v0.8? To help keep your code running, '
    + 'I automatically replaced `var sys = require(\'sys\')` with '
    + '`var util = require(\'util\')`.',
    '',
    'Enjoy!',
    '',
    '--'
    + '[' + botname + '](https://github.com/blakmatrix/node-migrator-bot)'
  ].join('\n');

botOptions.makeFileChanges = function makeFileChanges(fileList, link, cb) {

  if (fileList.some(function (ele) {return ele.indexOf('wscript') !== -1}) && fileList.some(function (ele) {return ele.indexOf('package.json') !== -1})) {
    setTotalRepositoryMatches(link);
    app.log.info('MATCH FOUND!'.green.bold.inverse + ' for ' + link.blue.bold);
    return cb(null, 'OK');
  } else {
    return cb(null, 'DONE');
  }

};

botOptions.filterList = function filterList(list, dir) {
  var reInclude = /(^\w*|package\.json|\w*\.wscript|wscript)$/gi,
      reExclude = /^(node_modules|\.git|)$/gi,
      modList = list.filter(function (str) {return  XRegExp.test(str, reInclude); })
                    .filter(function (str) {return !XRegExp.test(str, reExclude); });

  return modList;
};

botOptions.dbAdd = function dbAdd(link, cb) {
  redisClient.hset(npm_hash, link, 'processed');
  return null;
};

var dbAddComplete = botOptions.dbAddComplete = function (link, cb) {
  redisClient.hset(npm_hash, link, 'completed');
  return null;
};

botOptions.dbGetInfo = function dbGetInfo(cb) {
  redisClient.hgetall(npm_hash, function (err, data) {
    app.log.info('status    repository');
    app.log.info('--------- -------------------------------------------------------------');

    for (var i in data) {
      app.log.info(data[i] + ' ' + i);
      ++totalRepositories;
      if (data[i] === 'completed') {
        ++totalRepositoryMatches;
      }
    }

    return cb(null);
  });
};

var dbGetCompleted = function (cb) {
  redisClient.hgetall(npm_hash, function (err, data) {
    app.log.info('');
    app.log.info('List of matched repositories');
    app.log.info('----------------------------------------------------------------------');

    for (var i in data) {
      if (data[i] === 'completed') {
        app.log.info(i);
        ++totalRepositoryMatches;
      }
      ++totalRepositories;
    }
    return cb(null);
  });
};

botOptions.dbCheck = function dbCheck(link, cb) {
  redisClient.hget(npm_hash, link, function (err, hashk_value) {
    if (err) {
      cb(err);
    }
    cb(null, hashk_value);
  });
};
botOptions.makePullRequest = false;
botOptions.forkRepo = false;
botOptions.deleteRepo = false;

botOptions.setTotalNPMPackages = function setTotalNPMPackages(result) {
  totalNPMPackages = result.length;
  return null;
};

botOptions.setTotalRepositories = function setTotalRepositories(result) {
  totalRepositories = result.length;
  return null;
};

function setTotalRepositoryMatches(link) {
  totalRepositoryMatches++;
  dbAddComplete(link);
  repositoryMatchesList.push(link);
  return null;
}

function displayStats() {
  app.log.info('================================================================================');
  app.log.info('================================================================================');
  app.log.info('Stats:');
  if (totalNPMPackages) {
    app.log.info('NPM package totals:            ' + totalNPMPackages);
  }
  app.log.info('Github Repositories processed: ' + totalRepositories);
  app.log.info('Github Repositories Matched:   ' + totalRepositoryMatches);
  app.log.info('Github Repositories Affected:  ');
  console.dir(repositoryMatchesList);
  app.log.info('================================================================================');
}
// ============================================================================






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
app.use(require("./lib/node-migrator-bot"), botOptions);

app.commands.repo = function repo(link, cb) {
  this.log.info('Attempting to open path"' + link + '"');
  app.doRepoUpdate(link, cb);
};

app.commands.delrepo = function delRepo(repo, cb) {
  this.log.info('Attempting to open delete "' + username + '/' + repo + '"');
  app.deleteRepo(repo, 'DONE', cb);
};

app.commands.db = function db(cb) {
  this.log.info('Getting processed items in DB...');
  app.getDBinfo(cb);
};

app.commands.dbcompleted = function dbcompleted(cb) {
  this.log.info('Getting completed items in DB...');
  dbGetCompleted(cb);
};

app.commands.npm = function npm(link, cb) {
  this.log.warn('Running on all available npm repositories that are hosted on github!!!'.red.bold);
  app.doNPMUpdate(cb);
};

app.commands.user = function user(user, cb) {
  this.log.info('Attempting get information on "' + user + '"');
  app.doUserRepoUpdateStart(user, cb);
};

app.commands.file = function file(filename, cb) {
  this.log.info('Attempting to open "' + filename + '"');
  app.makeFileChanges(filename, cb);
};

app.start(function (err) {
  if (err) {
    app.log.error(err.message || 'You didn\'t call any commands! Type <app> use to see use cases');
    app.log.warn(botname.grey + ' NOT OK.');
    redisClient.quit();
    return process.exit(1);
  }
  redisClient.quit();
  //Stats
  displayStats();
  app.log.info(botname.grey + ' ok'.green.bold);
});