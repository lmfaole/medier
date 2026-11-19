//! The schema applied at the start of every run; `shared_data::app_db` owns how.

pub const SCHEMA: &str = include_str!("../../../../db/github.sql");

#[cfg(test)]
pub fn apply(db: &shared_data::sqlite_client::SqliteClient) -> anyhow::Result<()> {
    shared_data::app_db::apply_schema(db, SCHEMA)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_real_schema_is_only_idempotent_statements() {
        assert_eq!(shared_data::app_db::unsafe_to_repeat(SCHEMA), Vec::<String>::new());
    }
}
