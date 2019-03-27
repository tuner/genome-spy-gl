
// TODO: Sensible name for file, organization

import { extent } from 'd3-array';
import { color as d3color } from 'd3-color';

import { scaleOrdinal, scaleSequential } from 'd3-scale';
import * as d3ScaleChromatic from 'd3-scale-chromatic';

import { inferNumeric } from '../utils/variableTools';

export const defaultOrdinalScheme = d3ScaleChromatic.schemeCategory10;
export const defaultSequentialInterpolator = d3ScaleChromatic.interpolateYlOrRd;

/**
 * @typedef {Object} FieldEncodingConfig
 *    Defines how attributes (fields) are mapped to visual variables.
 * @prop {string} field A field of the data. An alternative to constant.
 * @prop {number[] | string[]} [domain]
 * @prop {number[] | string[]} [range]
 * @prop {String} [type]
 * 
 * @typedef {Object} ValueEncodingConfig
 * @prop {string | number} value A constant in the range. An alternative to field.
 * 
 * @typedef {Object} GenomicCoordinateEncodingConfig
 * @prop {string} chrom
 * @prop {string} pos
 * 
 * @typedef {FieldEncodingConfig | ValueEncodingConfig | GenomicCoordinateEncodingConfig} EncodingConfig
 * 
 * @typedef {Object} VariantDataConfig
 *    A configuration that specifies how data should be mapped
 *    to PointSpecs. The ultimate aim is to make this very generic
 *    and applicable to multiple types of data and visual encodings.
 * @prop {GatherConfig[]} gather
 * @prop {string} chrom
 * @prop {string} pos
 * @prop {Object} encodings 
 * @prop {SimpleFilterConfig[]} filters
 */

 
/**
 * @param {FieldEncodingConfig | string} encodingConfig 
 * @returns {FieldEncodingConfig}
 */
function formalizeFieldEncodingConfig(encodingConfig) {
    if (typeof encodingConfig == "string") {
        return { 
            field: encodingConfig
        };
    }

    return encodingConfig;
}

/**
 * Creates a function that maps fields to visual variables
 * 
 * @param {string} targetType
 * @param {FieldEncodingConfig | string} encodingConfig 
 * @param {object[]} [sampleData] Sample data for inferring types and domains
 * @returns {function(object):any}
 */
export function createFieldEncodingMapper(targetType, encodingConfig, sampleData) {
    // TODO: Consider dynamic code generation:
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function

    // TODO: Support constants

    encodingConfig = formalizeFieldEncodingConfig(encodingConfig);

    const accessor = d => d[/** @type {FieldEncodingConfig} */(encodingConfig).field]

    /** @type {function(any):any} */
    let mapper;

    let numericDomain;

    if (targetType == "number") {
        numericDomain = true;
        // TODO: Support domain and range and enforce ranges. For example, size must be within [0, 1]  
        // TODO: Infer domain from the sample data
        mapper = x => parseFloat(accessor(x));
        
    } else if (targetType == "color") {
        // Nominal or range types can be encoded as colors. Have to figure out which to use.

        let domain;
        if (encodingConfig.domain) {
            domain = encodingConfig.domain;
            numericDomain = encodingConfig.domain.every(x => typeof x == "number");
            // TODO: Check length if numeric

        } else {
            if (!sampleData || sampleData.length <= 0) {
                throw `Can't infer domain for ${encodingConfig.field}. No sampleData provided!`
            }
            const samples = sampleData.map(accessor);
            numericDomain = inferNumeric(samples);
            if (numericDomain) {
                domain = extent(samples, parseFloat);

            } else {
                domain = [...new Set(samples).values()].sort();
            }
        }

        if (numericDomain) {
            // TODO: Configurable interpolator
            // TODO: Support custom interpolators as an array of colors
            const scale = scaleSequential(defaultSequentialInterpolator)
                .domain(/** @type {[number, number]} */(domain))
                .clamp(true);

            mapper = x => scale(parseFloat(accessor(x)));

        } else {
            // TODO: Custom range by name
            const scale = scaleOrdinal(
                /** @type {ReadonlyArray} */(encodingConfig.range) ||
                defaultOrdinalScheme
            )
                .domain(domain)
                .unknown("#e0e0e0");

            mapper = x => scale(accessor(x));
        }


    } else {
        throw `Unknown type: ${targetType}`;
        // TODO: Support nominal types for symbols etc
    }

    // TODO: Add tests:
    mapper.config = encodingConfig;
    mapper.numeric = numericDomain;

    return mapper;
}

/**
 * 
 * @param {string} targetType 
 * @param {ValueEncodingConfig} encodingConfig 
 */
function createConstantValueMapper(targetType, encodingConfig) {
    const value = encodingConfig.value;

    if (targetType == "color") {
        const color = d3color(/** @type {any} */(value));
        if (!color) {
            throw new Error(`Not a proper color: ${value}`);
        }

        return () => color;

    } else if (targetType == "number") {
        const number = Number(value);
        if (isNaN(number)) {
            throw new Error(`Not a proper number: ${value}`);
        }

        return () => number;
    }
}

/**
 * 
 * @param {VisualMapperFactory} mapperFactory 
 * @param {Object[]} encodingConfigs 
 * @param {object} visualVariables
 * @param {object[]} sampleData 
 */
export function createCompositeEncodingMapper(mapperFactory, encodingConfigs, visualVariables, sampleData) {
    const mappers = {};

    Object.entries(encodingConfigs || {})
        .forEach(([/** @type {string} */visualVariable, encodingConfig]) => {
            if (!visualVariables[visualVariable]) {
                throw Error(`Unknown visual variable "${visualVariable}" in ${JSON.stringify(encodingConfigs)}`);
            }

            const targetType = visualVariables[visualVariable].type;

            mappers[visualVariable] = mapperFactory.createMapper(targetType, encodingConfig, sampleData);

            /*
            if (encodingConfig.field) {
                encodingConfig = formalizeFieldEncodingConfig(encodingConfig);

                mappers[visualVariable] = createFieldEncodingMapper(
                    targetType,
                    encodingConfig,
                    sampleData);

            } else if (encodingConfig.value) {
                mappers[visualVariable] = createConstantValueMapper(
                    targetType,
                    encodingConfig);

            } else if (encodingConfig.chrom) {
                // ...
            }
            */
        });

    const compositeMapper = d => {
        const mapped = {}
        Object.entries(mappers).forEach(([visualVariable, mapper]) => {
            mapped[visualVariable] = mapper(d);
        });
        return mapped;
    };

    // Export for tooltips
    compositeMapper.mappers = mappers;

    return compositeMapper;
}

export class VisualMapperFactory {
    constructor() {
        /** @type {{ predicate: function, mapperCreator: function }[]} */
        this.mappers = [{
            predicate: encodingConfig => typeof encodingConfig.value != "undefined",
            mapperCreator: createConstantValueMapper
        }, {
            predicate: encodingConfig => typeof encodingConfig == "string" || typeof encodingConfig.field == "string",
            mapperCreator: createFieldEncodingMapper
        }];
    }

    registerMapper(predicatorAndCreator) {
        this.mappers.push(predicatorAndCreator);
    }

    findMapperCreator(encodingConfig) {
        const t = this.mappers.find(t => t.predicate(encodingConfig));
        if (t) {
            return t.mapperCreator;
        } else {
            throw new Error("Can not find a mapper for encoding config: " + JSON.stringify(encodingConfig));
        }
    }

    /**
     * Creates a function that maps data to visual variables
     * 
     * @param {string} targetType
     * @param {Object | string} encodingConfig 
     * @param {object[]} [sampleData] Sample data for inferring types and domains
     * @returns {function(object):any}
     */
    createMapper(targetType, encodingConfig, sampleData) {
        return this.findMapperCreator(encodingConfig)(targetType, encodingConfig, sampleData);
    }
}
