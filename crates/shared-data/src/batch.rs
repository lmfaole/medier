//! Multi-row `INSERT` statements that stay under the bound-parameter cap, so a
//! tool writes a page of rows in a few statements instead of one each. The cap
//! is the 100 of the D1 this data came from, kept so a statement can still be
//! sent there.

use serde_json::Value;

pub const MAX_PARAMETERS: usize = 100;

/// `verb` is the statement up to the table, such as `INSERT OR IGNORE INTO`.
/// Every row must have one value per column.
#[must_use]
pub fn insert_statements(
    verb: &str,
    table: &str,
    columns: &[&str],
    rows: impl IntoIterator<Item = Vec<Value>>,
) -> Vec<(String, Vec<Value>)> {
    let rows_per_statement = (MAX_PARAMETERS / columns.len().max(1)).max(1);
    let names = columns.join(", ");
    let one_row = format!("({})", vec!["?"; columns.len()].join(", "));
    let rows: Vec<Vec<Value>> = rows.into_iter().collect();
    rows.chunks(rows_per_statement)
        .map(|chunk| {
            let values = vec![one_row.as_str(); chunk.len()].join(", ");
            (format!("{verb} {table} ({names}) VALUES {values}"), chunk.iter().flatten().cloned().collect())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rows_are_split_to_stay_under_the_cap() {
        let rows = (0..60).map(|index| vec![json!(index), json!("x"), json!(1), json!(2)]);
        let statements = insert_statements("INSERT OR IGNORE INTO", "t", &["a", "b", "c", "d"], rows);

        // 100 parameters / 4 columns = 25 rows a statement.
        assert_eq!(statements.len(), 3);
        assert!(statements.iter().all(|(_, params)| params.len() <= MAX_PARAMETERS));
        assert_eq!(statements[0].0.matches("(?, ?, ?, ?)").count(), 25);
        assert!(statements[0].0.starts_with("INSERT OR IGNORE INTO t (a, b, c, d) VALUES (?, ?, ?, ?), "));
    }

    #[test]
    fn no_rows_means_no_statements() {
        assert!(insert_statements("INSERT INTO", "t", &["a"], Vec::new()).is_empty());
    }
}
