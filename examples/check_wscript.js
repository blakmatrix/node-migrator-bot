botOptions.changesList = [
  {name: "Check For wscript and package.json files in a single repo",
   message: 'no commits this time',
   func: function (fileList, settings, cb) {
    if (fileList.some(function (ele) {return ele.indexOf('wscript') !== -1}) && fileList.some(function (ele) {return ele.indexOf('package.json') !== -1})) {
      setTotalRepositoryMatches(settings.link);
      app.log.info('MATCH FOUND!'.green.bold.inverse + ' for ' + settings.link.blue.bold);
      return cb(null, 'OK');
    } else {
      return cb(null, 'DONE');
    }
  }}
];

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

botOptions.makePullRequest    = false;
botOptions.forkRepo           = false;
botOptions.deleteRepo         = false;
botOptions.addOnFailedCommit  = true;
botOptions.addOnSuccessfulPR  = true;

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