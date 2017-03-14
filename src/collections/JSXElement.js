/*
 *  Copyright (c) 2015-present, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 *
 */

'use strict';

const _ = require('lodash');
const Collection = require('../Collection');
const NodeCollection = require('./Node');

const assert = require('assert');
const recast = require('recast');
const requiresModule = require('./VariableDeclarator').filters.requiresModule;

const types = recast.types.namedTypes;
const JSXElement = types.JSXElement;
const JSXAttribute = types.JSXAttribute;
const Literal = types.Literal;

/**
 * Contains filter methods and mutation methods for processing JSXElements.
 * @mixin
 */
const globalMethods = {
  /**
   * Finds all JSXElements optionally filtered by name
   *
   * @param {string} name
   * @return {Collection}
   */
  findJSXElements: function(name) {
    const nameFilter = name && {openingElement: {name: {name: name}}};
    return this.find(JSXElement, nameFilter);
  },

  /**
   * Finds all JSXElements by module name. Given
   *
   *     var Bar = require('Foo');
   *     <Bar />
   *
   * findJSXElementsByModuleName('Foo') will find <Bar />, without having to
   * know the variable name.
   */
  findJSXElementsByModuleName: function(moduleName) {
    assert.ok(
      moduleName && typeof moduleName === 'string',
      'findJSXElementsByModuleName(...) needs a name to look for'
    );

    return this.find(types.VariableDeclarator)
      .filter(requiresModule(moduleName))
      .map(function(path) {
        const id = path.value.id.name;
        if (id) {
          return Collection.fromPaths([path])
            .closestScope()
            .findJSXElements(id)
            .paths();
        }
      });
  },

  /**
   * Finds all JSXElements by package name. Given
   *
   *     import Bar from 'Foo';
   *     <Bar />
   *
   * findJSXElementsByImport('Foo') will find <Bar />, without having to
   * know the variable name.
   */
  findJSXElementsByImport: function(importName) {
    assert.ok(
      importName && typeof importName === 'string',
      'findJSXElementsByImport(...) needs a name to look for'
    );

    return this.find(types.ImportDeclaration, { source: { value: importName } })
      .find(types.ImportDefaultSpecifier)
      .map(path => {
        const id = path.node.local.name;
        if (id) {
          return Collection.fromPaths([path])
            .closestScope()
            .findJSXElements(id)
            .paths();
        }
      });
  },

  /**
   * Finds all JSXElements by named import. Given
   *
   *     import { Foo as Bar } from 'foo';
   *     <Bar />
   *
   * findJSXElementsByModuleName('foo', 'Foo') will find <Bar />, without having
   * to know the variable name.
   */
  findJSXElementsByNamedImport: function(importName, exportName) {
    assert.ok(
      importName && typeof importName === 'string' &&
      exportName && typeof exportName === 'string',
      'findJSXElementsByNamedImport(...) needs a name to look for'
    );

    return this.find(types.ImportDeclaration, { source: { value: importName } })
      .find(types.ImportSpecifier, { imported: { name: exportName }})
      .map(path => {
        const id = path.node.local.name;
        if (id) {
          return Collection.fromPaths([path])
            .closestScope()
            .findJSXElements(id)
            .paths();
        }
      });
  },
};

const filterMethods = {

  /**
   * Filter method for attributes.
   *
   * @param {Object} attributeFilter
   * @return {function}
   */
  hasAttributes: function(attributeFilter) {
    const attributeNames = Object.keys(attributeFilter);
    return function filter(path) {
      if (!JSXElement.check(path.value)) {
        return false;
      }
      const elementAttributes = Object.create(null);
      path.value.openingElement.attributes.forEach(function(attr) {
        if (!JSXAttribute.check(attr) ||
          !(attr.name.name in attributeFilter)) {
          return;
        }
        elementAttributes[attr.name.name] = attr;
      });

      return attributeNames.every(function(name) {
        if (!(name in elementAttributes) ){
          return false;
        }
        const value = elementAttributes[name].value;
        const expected = attributeFilter[name];
        const actual = Literal.check(value) ? value.value : value.expression;
        if (typeof expected === 'function') {
          return expected(actual);
        } else {
          // Literal attribute values are always strings
          return String(expected) === actual;
        }
      });
    };
  },

  /**
   * Filter elements which contain a specific child type
   *
   * @param {string} name
   * @return {function}
   */
  hasChildren: function(name) {
    return function filter(path) {
      return JSXElement.check(path.value) &&
        path.value.children.some(
          child => JSXElement.check(child) &&
                   child.openingElement.name.name === name
        );
    };
  }
};

/**
* @mixin
*/
const traversalMethods = {

  /**
   * Returns all child nodes, including literals and expressions.
   *
   * @return {Collection}
   */
  childNodes: function() {
    const paths = [];
    this.forEach(function(path) {
      const children = path.get('children');
      const l = children.value.length;
      for (let i = 0; i < l; i++) {
        paths.push(children.get(i));
      }
    });
    return Collection.fromPaths(paths, this);
  },

  /**
   * Returns all children that are JSXElements.
   *
   * @return {JSXElementCollection}
   */
  childElements: function() {
    const paths = [];
    this.forEach(function(path) {
      const children = path.get('children');
      const l = children.value.length;
      for (let i = 0; i < l; i++) {
        if (types.JSXElement.check(children.value[i])) {
          paths.push(children.get(i));
        }
      }
    });
    return Collection.fromPaths(paths, this, JSXElement);
  },
};

const mappingMethods = {
  /**
   * Given a JSXElement, returns its "root" name. E.g. it would return "Foo" for
   * both <Foo /> and <Foo.Bar />.
   *
   * @param {NodePath} path
   * @return {string}
   */
  getRootName: function(path) {
    let name = path.value.openingElement.name;
    while (types.JSXMemberExpression.check(name)) {
      name = name.object;
    }

    return name && name.name || null;
  }
};

function register() {
  NodeCollection.register();
  Collection.registerMethods(globalMethods, types.Node);
  Collection.registerMethods(traversalMethods, JSXElement);
}

exports.register = _.once(register);
exports.filters = filterMethods;
exports.mappings = mappingMethods;
