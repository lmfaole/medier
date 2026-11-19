//! The schema applied at the start of every run; `shared_data::app_db` owns how.

pub const SCHEMA: &str = include_str!("../../../../db/games.sql");

#[cfg(test)]
mod tests {
    #[test]
    fn the_real_schema_is_only_idempotent_statements() {
        assert!(shared_data::app_db::unsafe_to_repeat(super::SCHEMA).is_empty());
    }
}
