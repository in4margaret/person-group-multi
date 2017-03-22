# Unofficial library for Microsft Cognitive Services for Identify to work for more than 1000 persons.

Microsft Cognitive Services has limitiation of 1000 persons in person group to identify person by face image. 

This lib provides a way to identify more than 1000 persons by creating and maintaining several person groups.

This lib should work fine in several nodes environment, because Cognitive Services is used as a single source of truth and lib relies on error codes from Cognitive Services to know when person group is overflown.

## How to use 

Head over to [demo](demo/demo.ts)

## Some info

By default this lib will retry failed requests if fail reason has something to do with conflicts or quota limits. (Default max retry count for each operation is 5, default timeout between each retry is 100 ms).

You can change this by passing params to lib API construcrot 

```ts
/**
* maxRetryPerOperation maximum amount of retries for operations before error will be thrown
*/
maxRetryPerOperation?: number,
/**
* retryTimeout timeout in ms before retry attempt
*/
retryTimeout?: number
```