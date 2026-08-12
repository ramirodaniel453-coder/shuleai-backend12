'use strict';

function tableNameOf(model) {
  const value = model.getTableName();
  return typeof value === 'string' ? value : value.tableName;
}

function definitionFor(attribute) {
  const definition = {
    type: attribute.type,
    allowNull: attribute.allowNull,
    defaultValue: attribute.defaultValue,
    unique: attribute.unique,
    primaryKey: attribute.primaryKey,
    autoIncrement: attribute.autoIncrement,
    references: attribute.references,
    onUpdate: attribute.onUpdate,
    onDelete: attribute.onDelete
  };
  for (const key of Object.keys(definition)) if (definition[key] === undefined) delete definition[key];
  // Adding a required column with no default to a populated legacy table is
  // impossible in one safe DDL operation. Add it nullable; application/model
  // validation still prevents new invalid rows, while historical data remains
  // readable and can be backfilled by its domain migration.
  if (definition.allowNull === false && definition.defaultValue === undefined && !definition.primaryKey) {
    definition.allowNull = true;
  }
  return definition;
}

async function readSchema(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()`
  );
  const columnsByTable = new Map();
  for (const row of rows) {
    const table = String(row.table_name);
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Set());
    columnsByTable.get(table).add(String(row.column_name));
  }
  return columnsByTable;
}

async function reconcileModels(queryInterface, Sequelize, models) {
  const columnsByTable = await readSchema(queryInterface);
  for (const model of models) {
    if (!model) throw new Error('Canonical schema reconciliation received an unregistered model');
    const table = String(tableNameOf(model));
    let present = columnsByTable.get(table);
    if (!present) {
      await model.sync({ force: false });
      present = new Set(Object.entries(model.rawAttributes)
        .filter(([, attribute]) => !(attribute.type instanceof Sequelize.VIRTUAL))
        .map(([name, attribute]) => String(attribute.field || name)));
      columnsByTable.set(table, present);
      continue;
    }

    for (const [name, attribute] of Object.entries(model.rawAttributes)) {
      if (attribute.type instanceof Sequelize.VIRTUAL) continue;
      const column = String(attribute.field || name);
      if (present.has(column)) continue;
      await queryInterface.addColumn(table, column, definitionFor(attribute));
      present.add(column);
    }

    const missing = Object.entries(model.rawAttributes)
      .filter(([, attribute]) => !(attribute.type instanceof Sequelize.VIRTUAL))
      .map(([name, attribute]) => String(attribute.field || name))
      .filter(column => !present.has(column));
    if (missing.length) throw new Error(`Canonical schema reconciliation failed: ${table} is missing ${missing.join(', ')}`);
  }
}

module.exports = { reconcileModels, readSchema, tableNameOf };
