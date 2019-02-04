const rp = require('request-promise');
const _ = require('lodash');
const Promise = require('bluebird');

// wrap request-promise with up to 60 retries and an
// automatic JSON.parse of the response

async function request() {
  let result;
  let i;
  let lastError;
  for (i = 0; (i < 60); i++) {
    try {
      result = await rp.apply(null, arguments);
      break; 
    } catch (e) {
      lastError = e;
      console.log(`Retrying request (${i+1} of 60)...`);
      await Promise.delay(1000);
    }
  }
  if (i === 60) {
    throw lastError;
  }
  return JSON.parse(result);
}

module.exports = {
  moogBundle: {
    modules: [ 'apostrophe-doc-type-manager-popularity' ],
    directory: 'lib/modules'
  },
  construct: function(self, options) {
    self.addTask('update-metrics', 'Update popularity metrics for all documents for which external metrics\n' + 'such as Facebook likes are configured', async function(apos, argv) {
      await self.facebookUpdate();
    });
    self.facebookUpdate = async function() {
      const types = Object.keys(self.apos.docs.managers);
      for (let type of types) {
        const manager = self.apos.docs.getManager(type);
        if (!manager) {
          continue;
        }
        const req = self.apos.tasks.getReq();
        const fbOptions = manager.getOption(req, 'popularity.metrics.facebook');
        if (!fbOptions) {
          continue;
        }
        if (_.isEmpty(fbOptions)) {
          self.apos.utils.warn('facebook metrics are enabled for ' + manager.__meta.name + ', but\nno metrics such as "comments", "shares" or "reactions" have been configured.');
          continue;
        }
        let lastId = '';
        for (locale of self.getLocales()) {
          // Updates page metrics in batches of 100 for performance,
          // also a reasonable batch query size for sharedcount when that
          // API matures
          while (await batch(locale));
        }
        async function batch(locale) {
          // Public pages are the only interesting ones for FB popularity
          const req = self.apos.tasks.getAnonReq({ workflowLocale: locale });
          let pages = await manager.find(req, { 
            _id: {
              $gt: lastId
            }
          }, 
          { 
            _url: 1,
            popularityMetrics: 1
          }).sort({
            _id: 1
          }).limit(100).toArray();
          if (!pages.length) {
            return false;
          }
          lastId = pages[pages.length - 1]._id;
          pages = pages.filter(page => {
            return page._url;
          });
          const key = self.getOption(req, 'sharedcountApiKey');
          if (!key) {
            throw 'You must set the sharedcountApiKey option of apostrophe-docs-popularity.';
          }
          let response = await request('https://api.sharedcount.com/bulk', {
            method: 'POST',
            qs: {
              apikey: key
            },
            body: pages.map(page => page._url).join('\n')
          });
          if (!(response && response.bulk_id)) {
            throw 'Bad response from sharedcount, possibly they changed the bulk API';
          }
          const bulkId = response.bulk_id;
          let results;
          while (true) {
            const response = await request('https://api.sharedcount.com/bulk', {
              method: 'GET',
              qs: {
                apikey: key,
                bulk_id: bulkId
              }
            });
            if (response._meta && response._meta.completed) {
              results = response.data;
              break;
            }
            await Promise.delay(1000);
          }
          const ops = [];
          console.log('updating db');
          for (let page of pages) {
            const result = results[page._url] && results[page._url].Facebook;
            if (result) {
              const oldScore = (page.popularityMetrics && page.popularityMetrics.facebook && page.popularityMetrics.facebook.score) || 0.0;
              const score = self.facebookScore(results[page._url].Facebook, fbOptions);
              const facebook = {
                ...result,
                score
              };
              const delta = score - oldScore;
              ops.push({
                updateOne: {
                  filter: {
                    _id: page._id
                  },
                  update: {
                    $set: {
                      'popularityMetrics.facebook': facebook
                    },
                    $inc: {
                      'popularity': delta
                    }
                  }
                }
              });
            }
          }
          await self.apos.docs.db.bulkWrite(ops, { ordered: false });
          return true;
        }
      }
    };
    self.getLocales = function() {
      const workflow = self.apos.modules['apostrophe-workflow'];
      if (!workflow) {
        return [ 'default' ];
      }
      return Object.keys(workflow.locales).filter(locale => {
        return (!locale.match(/-draft$/)) && (!workflow.locales[locale].private);
      });
    };
    self.facebookScore = function(sharedcount, options) {
      if (!sharedcount) {
        return 0;
      }
      let score = 0;
      const map = {
        comments: 'comment_count',
        shares: 'share_count',
        reactions: 'reaction_count'
      };
      Object.keys(map).forEach(metric => {
        if (options[metric]) {
          score += (options[metric].score || 1.0) * sharedcount[map[metric]];
        }
      });
      return score;
    };
  }
};

