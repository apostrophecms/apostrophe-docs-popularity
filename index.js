const request = require('request-promise');
const _ = require('lodash');

module.exports = {
  construct: function(self, options) {
    self.addTask('update-metrics', 'Update popularity metrics of documents via Facebook graph APIs, etc.', async function(apos, argv) {
      await self.facebookUpdate();
    });
    self.facebookUpdate = async function() {
      const types = Object.keys(self.apos.docs.managers);
      for (let type of types) {
        const manager = self.apos.docs.getManager(type);
        if (!manager) {
          continue;
        }
        const fbOptions = manager.options.popularity && manager.options.popularity.metrics && manager.options.popularity.metrics.facebook;
        if (!fbOptions) {
          continue;
        }
        if (!(fbOptions.likes || fbOptions.shares)) {
          self.apos.utils.warn('facebook metrics are enabled for ' + manager.__meta.name + ', but\nneither "likes" nor "shares" are enabled.');
          continue;
        }
        let lastId = '';
        for (locale of self.getLocales()) {
          // Updates page metrics in batches of 50, which is also
          // Facebook's limit for batch queries
          while (await batch(locale));
        }
        async function batch(locale) {
          // Public pages are the only interesting ones for FB popularity
          const req = self.apos.tasks.getAnonReq({ workflowLocale: locale });
          let pages = await manager.find(req, { 
            _id: {
              $gte: lastId
            }
          }, 
          { 
            _url: 1,
            popularityMetrics: 1
          }).sort({
            _id: 1
          }).limit(50).toArray();
          if (!pages.length) {
            return false;
          }
          lastId = pages[pages.length - 1]._id;
          const batch = [];
          pages = pages.filter(page => {
            return page._url;
          });
          for (let page of pages) {
            if (page._url.substring(0, 4) !== 'http') {
              throw 'You must set the baseUrl option for your site when using this task.';
            }
            batch.push({
              method: 'GET',
              relative_url: '?fields=og_object%7Blikes.summary(total_count).limit(0)%7D,share&id=' + encodeURIComponent(page._url)
            });
          }
          if (!batch.length) {
            return true;
          }
          let response;
          for (let i = 0; (i < 60); i++) {
            try {
              response = await request('https://graph.facebook.com', {
                json: true,
                form: {
                  batch: JSON.stringify(batch)
                }
              });
              if ((!response) || (response.length !== query.batch.length)) {
                throw 'Malformed response from Facebook';
              }
              for (let item of response) {
                if ((!item) || (item.code >= 400)) {
                  throw 'Individual item has no response or bad status code: ' + (item && item.code);
                }
              }
              break;
            } catch (e) {
              console.warn(e);
              console.warn('Encountered facebook API issue, retrying in 1 minute');
              await Promise.delay(60000);
            }
          }
          for (let item of response) {
            if ((item.code >= 200) && (item.code < 300) && (item.body)) {
              const data = JSON.parse(item.body);
              const oldScore = self.facebookScore(page.popularityMetrics && page.popularityMetrics.facebook, fbOptions);
              page.popularityMetrics = page.popularityMetrics || {};
              page.popularityMetrics.facebook = page.popularityMetrics.facebook || {};
              page.popularityMetrics.facebook.likes = _.get(data, 'og_object.likes.summary.total_count');
              page.popularityMetrics.facebook.shares = _.get(data, 'share.share_count');
              const newScore = self.facebookScore(page.popularityMetrics.facebook, fbOptions);
              const delta = (newScore - oldScore);
              await self.apos.docs.db.update({
                _id: page._id
              }, {
                $set: {
                  'popularityMetrics.facebook': page.popularityMetrics.facebook
                }
              });
              await self.apos.docs.db.update({
                _id: page._id
              }, {
                $inc: {
                  'popularity': delta
                }
              });
            }
          }
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
    self.facebookScore = function(metrics, options) {
      if (!metrics) {
        return 0;
      }
      let score = 0;
      if (options.likes) {
        score += (options.likes.score || 1.0) * metrics.likes;
      }
      if (options.shares) {
        score += (options.shares.score || 1.0) * metrics.shares;
      }
      return score;
    };
  }
};

