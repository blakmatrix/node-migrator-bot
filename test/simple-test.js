var vows = require('vows'),
    assert = require('assert');

// Create a Test Suite
vows.describe('Truths').addBatch({
    'when comparing true to true': {
        topic: function () { return true === true },

        'we get true': function (topic) {
          assert.equal(topic, true);
        }
      },
      'but when comparing true to false': {
        topic: function () { return true === false },

        'we get false': function (topic) {
          assert.equal(topic, false);
        }
      }
    }).export(module);