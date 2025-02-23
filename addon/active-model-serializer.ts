import RESTSerializer from '@ember-data/serializer/rest';
import { normalizeModelName } from '@ember-data/store';
import type Store from '@ember-data/store';
import type Model from '@ember-data/model';
import { singularize, pluralize } from 'ember-inflector';
import { classify, decamelize, camelize, underscore } from '@ember/string';
import { inject as service } from '@ember/service';
import { isNone } from '@ember/utils';
import { AnyObject } from 'active-model-adapter';
// eslint-disable-next-line ember/use-ember-data-rfc-395-imports
import DS from 'ember-data';
// eslint-disable-next-line ember/use-ember-data-rfc-395-imports
import type ModelRegistry from 'ember-data/types/registries/model';

type ModelKeys<K> = Exclude<keyof K, keyof DS.Model>;
type RelationshipsFor<K extends keyof ModelRegistry> = ModelKeys<
  ModelRegistry[K]
>;

interface RelationshipMetaOptions {
  async?: boolean; // unspecified defaults relationship to "true"
  inverse?: string; // unspecified defaults to a lookup, which could be null but could find an inverse
  polymorphic?: boolean; // unspecified defaults to false
  [k: string]: unknown;
}

interface RelationshipMeta<K extends keyof ModelRegistry> {
  key: RelationshipsFor<K>;
  kind: 'belongsTo' | 'hasMany';
  type: keyof ModelRegistry;
  options: RelationshipMetaOptions;
  name: RelationshipsFor<K>;
  isRelationship: true;
}

interface Payload {
  [key: string]: unknown;
}

/**
  @module ember-data
 */

type RelationshipKind = 'belongsTo' | 'hasMany';

/**
  The ActiveModelSerializer is a subclass of the RESTSerializer designed to integrate
  with a JSON API that uses an underscored naming convention instead of camelCasing.
  It has been designed to work out of the box with the
  [active\_model\_serializers](http://github.com/rails-api/active_model_serializers)
  Ruby gem. This Serializer expects specific settings using ActiveModel::Serializers,
  `embed :ids, embed_in_root: true` which sideloads the records.

  This serializer extends the DS.RESTSerializer by making consistent
  use of the camelization, decamelization and pluralization methods to
  normalize the serialized JSON into a format that is compatible with
  a conventional Rails backend and Ember Data.

  ## JSON Structure

  The ActiveModelSerializer expects the JSON returned from your server
  to follow the REST adapter conventions substituting underscored keys
  for camelcased ones.

  ### Conventional Names

  Attribute names in your JSON payload should be the underscored versions of
  the attributes in your Ember.js models.

  For example, if you have a `Person` model:

  ```javascript
  export default class Person extends Model {
    @attr() firstName;
    @attr() lastName;
    @belongsTo('occupation') occupation;
  }
  ```

  The JSON returned should look like this:

  ```json
  {
    "famous_person": {
      "id": 1,
      "first_name": "Barack",
      "last_name": "Obama",
      "occupation": "President"
    }
  }
  ```

  Let's imagine that `Occupation` is just another model:

  ```javascript
  export default class Person extends Model {
    @attr() firstName;
    @attr() lastName;
    @belongsTo('occupation') occupation;
  }

  export default class Occupation extends Model {
    @attr() name;
    @attr('number') salary;
    @hasMany('person') people;
  }
  ```

  The JSON needed to avoid extra server calls, should look like this:

  ```json
  {
    "people": [{
      "id": 1,
      "first_name": "Barack",
      "last_name": "Obama",
      "occupation_id": 1
    }],

    "occupations": [{
      "id": 1,
      "name": "President",
      "salary": 100000,
      "person_ids": [1]
    }]
  }
  ```
*/
export default class ActiveModelSerializer extends RESTSerializer {
  @service declare store: Store;
  // SERIALIZE

  /**
    Converts camelCased attributes to underscored when serializing.
  */
  keyForAttribute(attr: string): string {
    return decamelize(attr);
  }

  /**
    Underscores relationship names and appends "_id" or "_ids" when serializing
    relationship keys.
  */
  keyForRelationship(relationshipModelName: string, kind?: string): string {
    const key = decamelize(relationshipModelName);
    if (kind === 'belongsTo') {
      return key + '_id';
    } else if (kind === 'hasMany') {
      return singularize(key) + '_ids';
    } else {
      return key;
    }
  }

  /**
   `keyForLink` can be used to define a custom key when deserializing link
   properties. The `ActiveModelSerializer` camelizes link keys by default.

  */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  keyForLink(key: string, _relationshipKind: RelationshipKind): string {
    return camelize(key);
  }

  /*
    Does not serialize hasMany relationships by default.
  */
  // eslint-disable-next-line
  serializeHasMany() {}

  /**
   Underscores the JSON root keys when serializing.
  */
  payloadKeyFromModelName(modelName: string | number): string {
    return underscore(decamelize(modelName as string));
  }

  /**
    Serializes a polymorphic type as a fully capitalized model name.
  */
  serializePolymorphicType<K extends keyof ModelRegistry>(
    snapshot: DS.Snapshot<K>,
    json: Payload,
    relationship: RelationshipMeta<K>
  ): void {
    const key = relationship.key;
    const belongsTo = snapshot.belongsTo(key);
    const jsonKey = underscore(key + '_type');

    if (isNone(belongsTo)) {
      json[jsonKey] = null;
    } else {
      json[jsonKey] = classify(belongsTo.modelName as string).replace(
        '/',
        '::'
      );
    }
  }

  /**
    Add extra step to `DS.RESTSerializer.normalize` so links are normalized.

    If your payload looks like:

    ```json
    {
      "post": {
        "id": 1,
        "title": "Rails is omakase",
        "links": { "flagged_comments": "api/comments/flagged" }
      }
    }
    ```

    The normalized version would look like this

    ```json
    {
      "post": {
        "id": 1,
        "title": "Rails is omakase",
        "links": { "flaggedComments": "api/comments/flagged" }
      }
    }
    ```
  */
  normalize(typeClass: Model, hash: AnyObject, prop: string): AnyObject {
    this.normalizeLinks(hash);
    return super.normalize(typeClass, hash, prop);
  }

  /**
    Convert `snake_cased` links  to `camelCase`
  */

  // eslint-disable-next-line
  normalizeLinks(data: any): void {
    if (data.links) {
      const links = data.links;

      for (const link in links) {
        const camelizedLink = camelize(link);

        if (camelizedLink !== link) {
          links[camelizedLink] = links[link];
          delete links[link];
        }
      }
    }
  }

  /**
   * @private
   */
  _keyForIDLessRelationship(
    key: string,
    relationshipType: RelationshipKind
  ): string {
    if (relationshipType === 'hasMany') {
      return underscore(pluralize(key));
    } else {
      return underscore(singularize(key));
    }
  }

  extractRelationships(modelClass: Model, resourceHash: AnyObject): AnyObject {
    modelClass.eachRelationship<Model>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (key: string, relationshipMeta: Record<string, any>) => {
        const relationshipKey = this.keyForRelationship(
          key,
          relationshipMeta.kind
        );

        const idLessKey = this._keyForIDLessRelationship(
          key,
          relationshipMeta.kind
        );

        // converts post to post_id, posts to post_ids
        if (
          resourceHash[idLessKey] &&
          typeof relationshipMeta[relationshipKey] === 'undefined'
        ) {
          resourceHash[relationshipKey] = resourceHash[idLessKey];
        }

        // prefer the format the AMS gem expects, e.g.:
        // relationship: {id: id, type: type}
        if (relationshipMeta.options.polymorphic) {
          extractPolymorphicRelationships(
            key,
            relationshipMeta,
            resourceHash,
            relationshipKey
          );
        }
        // If the preferred format is not found, use {relationship_name_id, relationship_name_type}
        if (
          Object.prototype.hasOwnProperty.call(resourceHash, relationshipKey) &&
          typeof resourceHash[relationshipKey] !== 'object'
        ) {
          const polymorphicTypeKey = this.keyForRelationship(key) + '_type';
          if (
            resourceHash[polymorphicTypeKey] &&
            relationshipMeta.options.polymorphic
          ) {
            const id = resourceHash[relationshipKey];
            const type = resourceHash[polymorphicTypeKey];
            delete resourceHash[polymorphicTypeKey];
            delete resourceHash[relationshipKey];
            resourceHash[relationshipKey] = { id: id, type: type };
          }
        }
      },
      this
    );
    return super.extractRelationships(modelClass, resourceHash);
  }

  modelNameFromPayloadKey<K extends keyof ModelRegistry>(key: K): string {
    const convertedFromRubyModule = singularize(key.replace('::', '/')) as K;
    return normalizeModelName(convertedFromRubyModule);
  }
}

function extractPolymorphicRelationships(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _relationshipMeta: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceHash: any,
  relationshipKey: string
) {
  const polymorphicKey = decamelize(key);
  const hash = resourceHash[polymorphicKey];
  if (hash !== null && typeof hash === 'object') {
    resourceHash[relationshipKey] = hash;
  }
}
