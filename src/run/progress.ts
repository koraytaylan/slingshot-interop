// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// What a run says while it is running, as opposed to what it reports when it
// has finished.
//
// The two are different documents with different readers. The report is written
// once, at the end, in TOML, for something that parses it; progress is written
// as it happens, in prose, for somebody watching a terminal. Mixing them would
// put a person's line inside a document a parser reads, so the run hands
// progress to a sink and the caller decides which stream it lands on.
//
// # A sink nobody supplies costs nothing
//
// A run in a test, or one embedded in something that reports its own way,
// passes no sink and gets silence. Nothing here reads an environment variable
// or writes a stream of its own, so what a run prints is exactly what its
// caller asked it to print.

// Where a run's progress goes. One line per call, already framed for a reader;
// the run has no stream of its own to choose between.
export type ProgressSink = (line: string) => void;

// Where progress goes when nobody asked for any.
export const silentProgress: ProgressSink = () => {};

// Writes progress to standard error, one line per call and nothing else.
//
// Standard error rather than standard output because a run has two readers with
// two different needs: the report is a document something parses, and these
// lines are for somebody watching. Keeping the report alone on standard output
// is what lets `interop > report.txt` name exactly the report, and it is the
// convention this entry point already had - its refusals already go to standard
// error.
//
// Written with `process.stderr.write` rather than `console.error` deliberately.
// `console.error` is the failure writer, and in a terminal its own formatting
// paints the whole line in the error colour: every step of a healthy run comes
// out red, which tells a reader that something has gone wrong when nothing has.
// This stream carries steps as well as refusals, so it is written raw.
export const stderrProgress: ProgressSink = (line) => {
	process.stderr.write(`${line}\n`);
};

// How long a wait runs before it says again that it is still waiting.
//
// A wait that has not finished is the one thing a watching reader cannot tell
// from a hang, so it is the one thing worth repeating. Fifteen seconds is short
// enough that a stall is obvious within a couple of notices and long enough
// that a normal startup does not bury the steps around it.
export const WAIT_NOTICE_SECONDS = 15;

// Returns how long something has been running, for a line that names it.
export function elapsedSeconds(sinceMs: number): number {
	return Math.max(0, Math.round((Date.now() - sinceMs) / 1000));
}

// Runs `work`, saying first that it has begun and then, every
// `noticeSeconds`, that it is still going.
//
// This is what keeps a long wait legible without every wait having to know what
// it is: the caller names the thing being waited for, and the shape of "still
// waiting, for this long" is written once. A wait that finishes says nothing
// further here - its own outcome is reported by the step that owns it.
//
// The cadence is a parameter so a caller that wants a different one can have
// it; what the run uses is `WAIT_NOTICE_SECONDS`.
export async function whileWaiting<T>(
	what: string,
	report: ProgressSink,
	work: () => Promise<T>,
	noticeSeconds: number = WAIT_NOTICE_SECONDS,
): Promise<T> {
	const startedAt = Date.now();
	const heartbeat = setInterval(() => {
		report(`still waiting for ${what} (${elapsedSeconds(startedAt)}s)`);
	}, noticeSeconds * 1000);
	try {
		return await work();
	} finally {
		clearInterval(heartbeat);
	}
}

// A sequence of named steps whose last one is the long one.
//
// The author runtime is the case this exists for: it starts a container and
// then performs several console writes and three readiness waits that settle in
// a fixed order, and most of its minute is spent in whichever of them is
// pending. Reporting only the first name would be wrong about the other six, so
// the reporter carries the name forward: each step says what it is as it
// begins, and the heartbeat repeats whichever name is current.
export type PhaseReporter = {
	// Names the step now beginning, and says so.
	readonly begin: (what: string) => void;
	// Stops the heartbeat. Idempotent, because a step that failed and a step
	// that finished both reach it.
	readonly done: () => void;
};

// Returns a reporter over `report` that repeats the current step's name.
export function phases(report: ProgressSink, noticeSeconds: number = WAIT_NOTICE_SECONDS): PhaseReporter {
	let current = "the author runtime to come up";
	let startedAt = Date.now();
	const heartbeat = setInterval(() => {
		report(`still waiting for ${current} (${elapsedSeconds(startedAt)}s)`);
	}, noticeSeconds * 1000);
	return {
		begin: (what: string) => {
			current = what;
			startedAt = Date.now();
			report(`  ${what}`);
		},
		done: () => clearInterval(heartbeat),
	};
}
