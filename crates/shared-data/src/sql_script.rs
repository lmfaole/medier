//! Splitting a hand-written, idempotent schema or migration file into statements, so a data
//! tool can apply it at the start of every run.

/// Statements split at `;`, with comments dropped. A `;` or `--` inside a single-quoted string
/// (`'it''s; fine -- really'`) belongs to the string, so data with a semicolon in a text can be
/// written in a migration.
#[must_use]
pub fn statements(schema: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut characters = schema.chars().peekable();
    while let Some(character) = characters.next() {
        if in_string {
            current.push(character);
            // A doubled quote is an escaped one and does not end the string.
            if character == '\'' && characters.peek() != Some(&'\'') {
                in_string = false;
            } else if character == '\'' {
                current.extend(characters.next());
            }
            continue;
        }
        match character {
            '\'' => {
                in_string = true;
                current.push(character);
            }
            '-' if characters.peek() == Some(&'-') => {
                while characters.peek().is_some_and(|next| *next != '\n') {
                    characters.next();
                }
            }
            ';' => {
                found.push(std::mem::take(&mut current));
            }
            _ => current.push(character),
        }
    }
    found.push(current);
    found.into_iter().map(|statement| statement.trim().to_string()).filter(|statement| !statement.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statements_ignores_a_semicolon_inside_a_comment() {
        let schema = "-- one; two\nCREATE TABLE a (x INTEGER); -- trailing; comment\nCREATE INDEX i ON a (x);\n";
        assert_eq!(statements(schema), vec!["CREATE TABLE a (x INTEGER)", "CREATE INDEX i ON a (x)"]);
    }

    #[test]
    fn statements_keeps_a_semicolon_and_a_dash_pair_inside_a_string() {
        let schema = "UPDATE t SET x = 'a; b -- c', y = 'it''s; fine' WHERE id = 1; -- done\nSELECT 1;";
        assert_eq!(statements(schema), vec!["UPDATE t SET x = 'a; b -- c', y = 'it''s; fine' WHERE id = 1", "SELECT 1"]);
    }
}
