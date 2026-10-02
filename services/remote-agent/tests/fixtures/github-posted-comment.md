# Posted GitHub comment fixture

`github-posted-comment.json` contains the unchanged identity and timestamp fields
read from the real GitHub API on 2026-10-01:

```text
gh api repos/amplifthq/openmeld/issues/comments/5920764449 \
  --jq '{id,url,html_url,node_id,created_at,updated_at,author_association}'
```

The comment's text and author record are omitted because the regression needs
only proof that the reported write exists and its returned identity survives.
No provider write is performed by the test.

The HTTP wrapper in `testOpenConnectorSuccessResponse` comes from
[OpenConnector's pinned serializer](https://github.com/oomol-lab/open-connector/blob/31be0d205cfd3f2b0a8f9ab5e3a54558976ed500/src/server/api/runtime-api.ts#L177-L190).
It includes the execution-owned `outputSchema` and exact action/execution
metadata. This is a captured GitHub payload inside a producer-defined wrapper,
not a captured production OpenConnector HTTP response. It does not establish
the precise response body of every reported production failure.
