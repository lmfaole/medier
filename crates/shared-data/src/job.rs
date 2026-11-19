//! The command line every data tool shares: a tool lists its jobs, this module
//! turns that list into the usage text, checks the arguments and runs the one
//! job asked for, so a new job is one entry and not another `match` arm.

use std::fmt::Write;

use anyhow::{bail, Context, Result};

/// What a job runs: with its arguments, or (an import of an export folder) with the folder and whether it is a dry run.
enum Run<C> {
    Args(fn(&C, &Args) -> Result<()>),
    Folder(fn(&C, &std::path::Path, bool) -> Result<()>),
}

/// What a job was given, already checked against its declaration.
pub struct Args<'a> {
    positional: Vec<&'a str>,
    flags: Vec<&'a str>,
}

impl<'a> Args<'a> {
    /// The `index`th required argument; `run_jobs` has checked that it exists.
    #[must_use]
    pub fn positional(&self, index: usize) -> &'a str {
        self.positional.get(index).copied().unwrap_or_default()
    }

    #[must_use]
    pub fn flag(&self, name: &str) -> bool {
        self.flags.contains(&name)
    }

}

/// `C` is whatever the jobs share, usually the database.
pub struct Job<C> {
    pub name: &'static str,
    pub help: &'static str,
    positional: &'static [&'static str],
    flags: &'static [&'static str],
    run: Run<C>,
}

impl<C> Job<C> {
    #[must_use]
    pub fn new(name: &'static str, help: &'static str, run: fn(&C, &Args) -> Result<()>) -> Self {
        Self { name, help, positional: &[], flags: &[], run: Run::Args(run) }
    }

    /// An import of an export folder: `<dir>` and `[--dry-run]`, handed to `run` as the folder and the flag.
    #[must_use]
    pub fn import_folder(name: &'static str, help: &'static str, run: fn(&C, &std::path::Path, bool) -> Result<()>) -> Self {
        Self { name, help, positional: &["dir"], flags: &["--dry-run"], run: Run::Folder(run) }
    }

    /// Names of the required arguments, in order.
    #[must_use]
    pub fn takes(mut self, positional: &'static [&'static str]) -> Self {
        self.positional = positional;
        self
    }

    /// The optional `--flags` the job understands.
    #[must_use]
    pub fn flags(mut self, flags: &'static [&'static str]) -> Self {
        self.flags = flags;
        self
    }

    fn signature(&self) -> String {
        let mut text = self.name.to_string();
        for name in self.positional {
            let _ = write!(text, " <{name}>");
        }
        for flag in self.flags {
            let _ = write!(text, " [{flag}]");
        }
        text
    }
}

/// `trailer` is for what the job lines cannot say, such as the values of an argument.
#[must_use]
pub fn usage<C>(program: &str, trailer: &str, jobs: &[Job<C>]) -> String {
    let width = jobs.iter().map(|job| job.signature().len()).max().unwrap_or(0);
    let mut text = format!("usage: {program} <job>\n");
    for job in jobs {
        let _ = writeln!(text, "  {:width$}  {}", job.signature(), job.help);
    }
    if !trailer.is_empty() {
        text.push_str(trailer);
    }
    text.trim_end().to_string()
}

/// Runs the job named by the first argument, or fails with the usage text when
/// there is none, it is unknown or its arguments do not fit. `context` is built
/// only after that check, so a wrong command never opens or creates a database.
pub fn run_jobs<C>(
    program: &str,
    trailer: &str,
    jobs: &[Job<C>],
    context: impl FnOnce() -> Result<C>,
    args: &[&str],
) -> Result<()> {
    let Some((name, rest)) = args.split_first() else {
        bail!("{}", usage(program, trailer, jobs));
    };
    let Some(job) = jobs.iter().find(|job| job.name == *name) else {
        bail!("unknown job {name:?}\n{}", usage(program, trailer, jobs));
    };
    let (flags, positional): (Vec<&str>, Vec<&str>) = rest.iter().partition(|argument| argument.starts_with("--"));
    if positional.len() != job.positional.len() || flags.iter().any(|flag| !job.flags.contains(flag)) {
        bail!("{}", usage(program, trailer, jobs));
    }
    let context = context()?;
    let args = Args { positional, flags };
    match job.run {
        Run::Args(run) => run(&context, &args),
        Run::Folder(run) => run(&context, std::path::Path::new(args.positional(0)), args.flag("--dry-run")),
    }
    .with_context(|| format!("{program} {name}"))
}

/// Runs the job this process was asked for: the arguments are the command line's own, which is what every data tool's
/// `main` wants.
pub fn run_from_argv<C>(program: &str, trailer: &str, jobs: &[Job<C>], context: impl FnOnce() -> Result<C>) -> Result<()> {
    let words: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = words.iter().map(String::as_str).collect();
    run_jobs(program, trailer, jobs, context, &args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    type Log = Rc<RefCell<Vec<String>>>;

    fn jobs() -> Vec<Job<Log>> {
        vec![
            Job::new("plain", "does nothing", |log: &Log, _| {
                log.borrow_mut().push("plain".into());
                Ok(())
            }),
            Job::new("import", "reads a folder", |log: &Log, args| {
                log.borrow_mut().push(format!("{} {}", args.positional(0), args.flag("--dry-run")));
                Ok(())
            })
            .takes(&["dir"])
            .flags(&["--dry-run"]),
        ]
    }

    fn run(args: &[&str]) -> (Result<()>, Vec<String>) {
        let log: Log = Rc::default();
        let result = run_jobs("tool", "", &jobs(), || Ok(Rc::clone(&log)), args);
        let lines = log.borrow().clone();
        (result, lines)
    }

    #[test]
    fn the_context_is_built_only_for_a_valid_command() {
        let built = Cell::new(0);
        let context = || {
            built.set(built.get() + 1);
            Ok(Log::default())
        };
        assert!(run_jobs("tool", "", &jobs(), context, &["nope"]).is_err());
        assert!(run_jobs("tool", "", &jobs(), context, &["import"]).is_err());
        assert_eq!(built.get(), 0);
        assert!(run_jobs("tool", "", &jobs(), context, &["plain"]).is_ok());
        assert_eq!(built.get(), 1);
    }

    #[test]
    fn a_job_gets_its_argument_and_flag() {
        assert_eq!(run(&["import", "folder", "--dry-run"]).1, vec!["folder true"]);
        assert_eq!(run(&["import", "folder"]).1, vec!["folder false"]);
    }

    #[test]
    fn bad_arguments_print_the_usage_and_run_nothing() {
        for args in [&[][..], &["nope"], &["plain", "extra"], &["import"], &["import", "dir", "--wet"]] {
            let (result, log) = run(args);
            assert!(log.is_empty());
            assert!(format!("{:#}", result.unwrap_err()).contains("usage: tool <job>"));
        }
    }

    #[test]
    fn a_failing_job_says_which_one() {
        let jobs = vec![Job::new("boom", "", |(): &(), _| anyhow::bail!("inner"))];
        let error = run_jobs("tool", "", &jobs, || Ok(()), &["boom"]).unwrap_err();
        assert_eq!(format!("{error:#}"), "tool boom: inner");
    }
}
