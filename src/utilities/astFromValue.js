/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import { forEach, isCollection } from 'iterall';

import invariant from '../jsutils/invariant';
import isNullish from '../jsutils/isNullish';
import type {
  Value,
  IntValue,
  FloatValue,
  StringValue,
  BooleanValue,
  EnumValue,
  ListValue,
  ObjectValue,
} from '../language/ast';
import {
  NAME,
  INT,
  FLOAT,
  STRING,
  BOOLEAN,
  ENUM,
  LIST,
  OBJECT,
  OBJECT_FIELD,
} from '../language/kinds';
import type { GraphQLInputType } from '../type/definition';
import {
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
} from '../type/definition';
import { GraphQLID } from '../type/scalars';


/**
 * Produces a GraphQL Value AST given a JavaScript value.
 *
 * A GraphQL type must be provided, which will be used to interpret different
 * JavaScript values.
 *
 * | JSON Value    | GraphQL Value        |
 * | ------------- | -------------------- |
 * | Object        | Input Object         |
 * | Array         | List                 |
 * | Boolean       | Boolean              |
 * | String        | String / Enum Value  |
 * | Number        | Int / Float          |
 * | Mixed         | Enum Value           |
 *
 */
export function astFromValue(
  value: mixed,
  type: GraphQLInputType
): ?Value {
  // Ensure flow knows that we treat function params as const.
  const _value = value;

  if (type instanceof GraphQLNonNull) {
    // Note: we're not checking that the result is non-null.
    // This function is not responsible for validating the input value.
    return astFromValue(_value, type.ofType);
  }

  if (isNullish(_value)) {
    return null;
  }

  // Convert JavaScript array to GraphQL list. If the GraphQLType is a list, but
  // the value is not an array, convert the value using the list's item type.
  if (type instanceof GraphQLList) {
    const itemType = type.ofType;
    if (isCollection(_value)) {
      const valuesASTs = [];
      forEach((_value: any), item => {
        const itemAST = astFromValue(item, itemType);
        if (itemAST) {
          valuesASTs.push(itemAST);
        }
      });
      return ({ kind: LIST, values: valuesASTs }: ListValue);
    }
    return astFromValue(_value, itemType);
  }

  // Populate the fields of the input object by creating ASTs from each value
  // in the JavaScript object according to the fields in the input type.
  if (type instanceof GraphQLInputObjectType) {
    if (_value === null || typeof _value !== 'object') {
      return null;
    }
    const fields = type.getFields();
    const fieldASTs = [];
    Object.keys(fields).forEach(fieldName => {
      const fieldType = fields[fieldName].type;
      const fieldValue = astFromValue(_value[fieldName], fieldType);
      if (fieldValue) {
        fieldASTs.push({
          kind: OBJECT_FIELD,
          name: { kind: NAME, value: fieldName },
          value: fieldValue
        });
      }
    });
    return ({ kind: OBJECT, fields: fieldASTs }: ObjectValue);
  }

  invariant(
    type instanceof GraphQLScalarType || type instanceof GraphQLEnumType,
    'Must provide Input Type, cannot use: ' + String(type)
  );

  // Since value is an internally represented value, it must be serialized
  // to an externally represented value before converting into an AST.
  const serialized = type.serialize(_value);
  if (isNullish(serialized)) {
    return null;
  }

  // Others serialize based on their corresponding JavaScript scalar types.
  if (typeof serialized === 'boolean') {
    return ({ kind: BOOLEAN, value: serialized }: BooleanValue);
  }

  // JavaScript numbers can be Int or Float values.
  if (typeof serialized === 'number') {
    const stringNum = String(serialized);
    return /^[0-9]+$/.test(stringNum) ?
      ({ kind: INT, value: stringNum }: IntValue) :
      ({ kind: FLOAT, value: stringNum }: FloatValue);
  }

  if (typeof serialized === 'string') {
    // Enum types use Enum literals.
    if (type instanceof GraphQLEnumType) {
      return ({ kind: ENUM, value: serialized }: EnumValue);
    }

    // ID types can use Int literals.
    if (type === GraphQLID && /^[0-9]+$/.test(serialized)) {
      return ({ kind: INT, value: serialized }: IntValue);
    }

    // Use JSON stringify, which uses the same string encoding as GraphQL,
    // then remove the quotes.
    return ({
      kind: STRING,
      value: JSON.stringify(serialized).slice(1, -1)
    }: StringValue);
  }

  throw new TypeError('Cannot convert value to AST: ' + String(serialized));
}
