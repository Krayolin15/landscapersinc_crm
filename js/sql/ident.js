// Safe SQL identifiers for the SQL generators (js/sql/*.js).
// A column such as mail_messages.to is a reserved word in PostgreSQL and must be written "to".

// PostgreSQL reserved key words (SQL key words appendix: "reserved" and "reserved (can be function or type)").
export const RESERVED = new Set(`all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation
column concurrently constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp
current_user default deferrable desc distinct do else end except false fetch for foreign freeze from full grant group having ilike in
initially inner intersect into is isnull join lateral leading left like limit localtime localtimestamp natural not notnull null offset on
only or order outer overlaps placing primary references returning right select session_user similar some symmetric system_user table
tablesample then to trailing true union unique user using variadic verbose when where window with`.split(/\s+/));

/** Quote an identifier when it is not a plain lower-case name or when it is a reserved word. */
export const ident = s => (/^[a-z_][a-z0-9_]*$/.test(s) && !RESERVED.has(s) ? s : `"${String(s).replace(/"/g, '""')}"`);
