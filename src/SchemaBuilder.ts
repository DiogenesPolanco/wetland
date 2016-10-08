import {Mapping, FieldOptions, Raw} from './Mapping';
import {EntityInterface, EntityCtor} from './EntityInterface';
import * as Knex from 'knex';
import {Scope} from './Scope';
import {Store} from './Store';
import {index} from './decorators/Mapping';

export class SchemaBuilder {

  /**
   * @type {Array}
   */
  private creates: Array<Knex.SchemaBuilder> = [];

  /**
   * @type {Array}
   */
  private alters: Array<Knex.SchemaBuilder> = [];

  /**
   * @type {Scope}
   */
  private entityManager: Scope;

  /**
   * @type {boolean}
   */
  private built: boolean = false;

  /**
   * @type {Knex}
   */
  private client: Knex;

  /**
   * @type {string[]}
   */
  private types = [
    'integer',
    'bigInteger',
    'text',
    'string',
    'float',
    'decimal',
    'boolean',
    'date',
    'dateTime',
    'datetime',
    'time',
    'timestamp',
    'binary',
    'json',
    'jsonb',
    'uuid',
  ];

  /**
   * @param {Scope} entityManager
   */
  public constructor(entityManager: Scope) {
    this.entityManager = entityManager;
    this.client        = entityManager.getStore().getConnection(Store.ROLE_MASTER);
  }

  /**
   * Get the schema queries.
   *
   * @returns {string}
   */
  public getSQL(): string {
    let queries = [];

    this.creates.forEach(create => {
      let query = create.toString();

      if (query) {
        queries.push(create.toString());
      }
    });

    this.alters.forEach(alter => {
      let query = alter.toString();

      if (query) {
        queries.push(alter.toString());
      }
    });

    return queries.join('\n');
  }

  /**
   * Persist the schema to the database.
   *
   * @returns {Promise<any[]>}
   */
  public apply() {
    let createQueries = [];

    this.creates.forEach(create => {
      createQueries.push(create.then());
    });

    return Promise.all(createQueries).then(() => {
      let alterQueries = [];

      this.alters.forEach(alter => {
        alterQueries.push(alter.then());
      });

      return Promise.all(alterQueries);
    });
  }

  /**
   * Create the schema.
   *
   * @returns {SchemaBuilder}
   */
  public create(): this {
    if (this.built) {
      return this;
    }

    let entities = this.entityManager.getEntities();

    Object.getOwnPropertyNames(entities).forEach(entity => this.processEntity(entities[entity]));

    this.built = true;

    return this;
  }

  /**
   * Process an entity to create the schema.
   *
   * @param {EntityCtor} entity
   */
  private processEntity(entity: EntityCtor<EntityInterface>) {
    let mapping   = Mapping.forEntity(entity);
    let tableName = mapping.getTableName();
    let relations = this.processRelations(mapping);

    this.addBuilder(entity, tableName, table => {
      this.composeFields(table, mapping.getFields());
      if (!relations) {
        return;
      }

      this.composeFields(table, relations.joinColumns);

      relations.foreignKeys.forEach(foreignKey => {
        let foreign = table.foreign(foreignKey.foreign).references(foreignKey.references).inTable(foreignKey.inTable);

        this.applyCascades(mapping.getField(foreignKey.owning).cascades, foreign);
      });
    });

    this.addBuilder(entity, tableName, table => {
      this.composeIndexes(table, mapping);
    }, true);

  }

  /**
   * Add a builder.
   *
   * @param {EntityCtor}  entity
   * @param {string}      tableName
   * @param {Function}    builder
   * @param {boolean}     [alter]
   */
  private addBuilder(entity: EntityCtor<EntityInterface>, tableName: string, builder: (tableBuilder: Knex.CreateTableBuilder) => any, alter: boolean = false) {
    let schemaBuilder = this.entityManager.getStore(entity).getConnection(Store.ROLE_MASTER).schema;

    if (alter) {
      this.alters.push(schemaBuilder.table(tableName, builder) as Knex.SchemaBuilder);
    } else {
      this.creates.push(schemaBuilder.createTable(tableName, builder));
    }
  }

  /**
   * Compose provided fields.
   *
   * @param {Knex.TableBuilder} tableBuilder
   * @param {{}}                fields
   *
   * @returns {SchemaBuilder}
   */
  private composeFields(tableBuilder: Knex.TableBuilder, fields: {[key: string]: FieldOptions}): this {
    Object.getOwnPropertyNames(fields).forEach(property => {
      this.composeField(tableBuilder, fields[property])
    });

    return this;
  }

  /**
   * Process the relations on mapping.
   *
   * @param {Mapping} mapping
   *
   * @returns {SchemaBuilder}
   */
  private processRelations(mapping: Mapping<EntityInterface>): ProcessedRelations {
    let entity      = mapping.getTarget();
    let relations   = mapping.getRelations();
    let foreignKeys = [];
    let joinColumns = {};

    if (!relations) {
      return;
    }

    Object.getOwnPropertyNames(relations).forEach(property => {
      let relation      = relations[property];
      let targetMapping = Mapping.forEntity(this.entityManager.resolveEntityReference(relation.targetEntity));

      if ((relation.type === Mapping.RELATION_MANY_TO_ONE) || (relation.type === Mapping.RELATION_ONE_TO_ONE && !relation.mappedBy)) {
        let column = mapping.getJoinColumn(property);

        joinColumns[column.name] = {
          name    : column.name,
          type    : 'integer',
          unsigned: true,
          nullable: true
        };

        return foreignKeys.push({
          owning    : property,
          foreign   : column.name,
          references: column.referencedColumnName,
          inTable   : targetMapping.getTableName()
        });
      }

      // Nothing to do for other side.
      if (relation.type === Mapping.RELATION_ONE_TO_MANY || !relation.inversedBy) {
        return;
      }

      // This is many to many.
      let foreignColumns          = [];
      let referenceColumns        = [];
      let foreignColumnsInverse   = [];
      let referenceColumnsInverse = [];
      let joinTableIndexes        = [];
      let joinTableFields         = {
        id: {
          name          : 'id',
          primary       : true,
          type          : 'integer',
          generatedValue: 'autoIncrement'
        }
      };

      let joinTable;

      if (relation.inversedBy) {
        joinTable = mapping.getJoinTable(property, this.entityManager);
      } else {
        joinTable = targetMapping.getJoinTable(relation.mappedBy, this.entityManager);
      }

      let processTableColumns = (side, foreign, reference)=> {
        joinTableFields[side.name] = {
          name    : side.name,
          type    : side.type || 'integer',
          size    : side.size,
          unsigned: true,
          nullable: true
        };

        joinTableIndexes.push({columns: side.name, name: side.indexName});
        foreign.push(side.referencedColumnName);
        reference.push(side.name);
      };

      joinTable.joinColumns.forEach(column => processTableColumns(column, foreignColumns, referenceColumns));
      joinTable.inverseJoinColumns.forEach(column => processTableColumns(column, referenceColumnsInverse, foreignColumnsInverse));

      this.addBuilder(entity, joinTable.name, table => {
        this.composeFields(table, joinTableFields);

        joinTableIndexes.forEach(index => {
          table.index(index.columns);
        });


        let foreignInverse = table.foreign(foreignColumnsInverse).references(referenceColumnsInverse).inTable(targetMapping.getTableName());
        let foreign        = table.foreign(referenceColumns).references(foreignColumns).inTable(mapping.getTableName());

        this.applyCascades(mapping.getField(property).cascades, foreignInverse);
        this.applyCascades(mapping.getField(property).cascades, foreign);
      });
    });

    return {joinColumns, foreignKeys};
  }

  /**
   * Apply cascades to provided table builder.
   *
   * @param {string[]}           cascades
   * @param {Knex.ColumnBuilder} foreign
   */
  private applyCascades(cascades: Array<string>, foreign: Knex.ColumnBuilder) {
    if (!cascades) {
      return;
    }

    cascades.forEach(cascade => {
      if (cascade === Mapping.CASCADE_PERSIST) {
        return;
      }

      if (cascade === Mapping.CASCADE_UPDATE) {
        foreign.onUpdate('cascade');
      } else if (cascade === Mapping.CASCADE_DELETE) {
        foreign.onDelete('cascade');
      }
    });
  }

  /**
   * Compose the indexes for mapping.
   *
   * @param {Knex.TableBuilder} indexBuilder
   * @param {Mapping}           mapping
   *
   * @returns {SchemaBuilder}
   */
  private composeIndexes(indexBuilder: Knex.TableBuilder, mapping: Mapping<EntityInterface>): this {
    let indexes           = mapping.getIndexes();
    let uniqueConstraints = mapping.getUniqueConstraints();

    Object.getOwnPropertyNames(indexes).forEach(indexName => {
      console.log(indexes);
      indexBuilder.index(indexes[indexName].map(field => mapping.getColumnName(field)), indexName);
    });

    Object.getOwnPropertyNames(uniqueConstraints).forEach(constraintName => {
      indexBuilder.unique(uniqueConstraints[constraintName].map(field => mapping.getColumnName(field)), constraintName);
    });

    return this;
  }

  /**
   * Compose a field.
   *
   * @param {Knex.TableBuilder} tableBuilder
   * @param {FieldOptions}      field
   */
  private composeField(tableBuilder: Knex.TableBuilder, field: FieldOptions) {
    let column;

    if (field.generatedValue) {
      if (field.generatedValue === 'autoIncrement') {
        column = tableBuilder.increments(field.name);
      } else {
        throw new Error(`Unknown strategy '${field.generatedValue}' supplied for generatedValue.`);
      }
    }

    if (!column) {
      if (!field.type) {
        return;
      }

      if (this.types.indexOf(field.type) === -1) {
        throw new Error(`Unknown field type '${field.type}' supplied.`);
      }

      column = this[field.type](tableBuilder, field) as Knex.ColumnBuilder;
    }

    if (field.unsigned) {
      column.unsigned();
    }

    if (field.comment) {
      column.comment(field.comment);
    }

    if (field.nullable) {
      column.nullable();
    } else {
      column.notNullable();
    }

    if (field.primary) {
      column.primary();
    }

    if (field.defaultTo) {
      if (field.defaultTo instanceof Raw) {
        column.defaultTo(this.client.raw(field.defaultTo.getQuery()));
      } else {
        column.defaultTo(field.defaultTo);
      }
    }
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public integer(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.integer(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public bigInteger(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.bigInteger(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public text(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.text(field.name, field.textType || 'text');
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public string(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.string(field.name, field.size || 255);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public float(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.float(field.name, field.precision || 8, field.scale || 2);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public decimal(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.decimal(field.name, field.precision || 8, field.scale || 2);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public boolean(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.boolean(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public date(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.date(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public dateTime(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.dateTime(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public datetime(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.dateTime(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public time(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.time(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public timestamp(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.timestamp(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public binary(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.binary(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public json(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.json(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public jsonb(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.jsonb(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public uuid(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.uuid(field.name);
  }

  /**
   * Define a column type.
   *
   * @param {Knex.TableBuilder} table
   * @param {FieldOptions}      field
   *
   * @returns {ColumnBuilder}
   */
  public enumeration(table: Knex.TableBuilder, field: FieldOptions): Knex.ColumnBuilder {
    return table.enu(field.name, field.enumeration);
  }
}

export interface ProcessedRelations {
  joinColumns: {[key: string]: FieldOptions},
  foreignKeys: Array<{owning: string, foreign: string, references: string, inTable: string}>
}
