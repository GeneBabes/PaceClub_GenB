# Recording checks

Use `ACCEPTANCE_CHECKS.md` for the complete current test sequence. Onboarding is available on both platforms.

The mobile recorder stores accepted GPS samples and metadata in SQLite, pauses when the app leaves the foreground, and recovers at the last durable checkpoint. It never adds distance across a pause or missing GPS segment. Finish, review and submit; new submissions are now recalculated by the server and become verified or flagged with a reason.

Offline submissions stay queued until a connection is available with the app open. Use Retry upload if needed. A stable activity UUID and sample numbers prevent duplicate uploads. Only verified eligible GPS activities earn credit. GPX imports and desk practice remain explicitly unranked.

Keep the installed app and signing identity until unsent activities are uploaded. Uninstalling or clearing data removes local recordings. Background GPS recording is not implemented.
