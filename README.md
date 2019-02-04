# apostrophe-docs-popularity

Tracks the popularity of your documents according to various metrics of your choice,
resulting in a `popularity` property for each document. You get to choose which
doc types participate.

Currently the metrics available are Facebook social reactions (including likes),
Facebook comments and Facebook shares.

Facebook "dislikes" cannot be distinguished from likes.

Facebook data is obtained via the [sharedcount API](https://sharedcount.com). You will
need to obtain an API key from sharedcount to use this module.

## Configuration

```javascript
// in app.js
const apos = require('apostrophe')({
  modules: {
    'apostrophe-docs-popularity': {
      sharedcountApiKey: 'GOGETYOUROWN'
    },
    // configure it for one piece type
    'profiles': {
      extend: 'apostrophe-pieces',
      name: 'profile',
      // etc, then...
      popularity: {
        metrics: {
          facebook: {
            reactions: {
              // Give each metric a score so you can
              // weight some as more important than others
              score: 1
            },
            comments: {
              score: 2
            },
            shares: {
              score: 3
            }
          }
        }
      }
    },
    // configure it for all pages (not pieces)
    'apostrophe-custom-pages': {
      popularity: // see above
    },
    // configure it for all docs with URLs,
    // both pages and pieces
    'apostrophe-doc-type-manager': {
      popularity: // see above
    }
  }
});
```

## Updating popularity

Use the provided command line task:

```
node app apostrophe-docs-popularity:update-metrics
```

[Use `cron`](https://opensource.com/article/17/11/how-use-cron-linux) to schedule this to
run at a time of your choosing, probably no more than once a day. See the `sharedcount`
website for API quotas and pricing.

## Sorting by popularity

The simplest way is to just change the default sort for one of your piece types.
Let's continue the `profiles` module example from before:

```javascript
    'profiles': {
      extend: 'apostrophe-pieces',
      name: 'profile',
      // Sort by popularity (descending order), then by title
      // as a tiebreaker
      sort: { popularity: -1, title: 1 },
      popularity: { ... see above ... }
    }
```

You can also sort any Apostrophe `find()` query by popularity:

```javascript
// Most popular profile first
const profiles = self.apos.getManager('profile')
  .find(req)
  .sort({ popularity: -1 })
  .limit(10)
  .toArray();
```

For instance, you might do that in an
[apostrophe-pages:beforeSend promise event handler](https://apostrophecms.org/docs/events.html)
and attach it to `req.data.profiles`.

`popularity` is just a `mongodb` document property, so this works with direct MongoDB
queries too.

## Displaying popularity

If you have a piece, you could display its `popularity` score simply as `piece.popularity`.
But you're probably also interested in displaying individual metrics like the
number of Facebook reactions.

You can access that number as `piece.popularityMetrics.facebook.reactions`.

Note that likes, dislikes, "wow" reactions, etc. cannot be distinguished from one another.
This is a limitation of the data available from the API.

