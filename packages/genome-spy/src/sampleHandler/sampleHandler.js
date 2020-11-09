import { group, quantileSorted, range, sort as d3sort } from "d3-array";
import produce from "immer";

import * as Actions from "./sampleHandlerActions";
import { peek } from "../utils/arrayUtils";
import { isNumber } from "vega-util";
import {
    sort,
    retainFirstOfEach,
    filterQuantitative,
    filterNominal,
    filterUndefined,
    wrapAccessorForComparison
} from "./operations";
import Provenance from "./provenance";

/**
 * This class handles sample sorting, filtering, grouping, etc.
 *
 * TODO: Consider employing Redux, Mobx, Trrack, ...
 *
 * @typedef {import("./sampleState").State} State
 * @typedef {import("./sampleState").Group} Group
 * @typedef {import("./sampleState").SampleGroup} SampleGroup
 * @typedef {import("./sampleState").GroupGroup} GroupGroup
 *
 * @typedef {object} AttributeIdentifier An identifier for an abstract attribute.
 *      Allows for retrieving an accessor and information.
 * @prop {string} type
 * @prop {any} [specifier]
 *
 * @typedef {object} AttributeInfo
 * @prop {string} name
 * @prop {function(string):any} accessor A function that maps a sampleId to an attribute value
 * @prop {string} type e.g., "quantitative"
 * @prop {any} scale
 *
 * @typedef {(function(AttributeIdentifier):AttributeInfo)} AttributeInfoSource
 *
 */
export default class SampleHandler {
    constructor() {
        /**
         *
         * @type {Record<string, AttributeInfoSource>}
         */
        this.attributeInfoSourcesByType = {};

        /** @type {Provenance<State>} */
        this.provenance = new Provenance();
    }

    get state() {
        return this.provenance.state;
    }

    /**
     *
     * @param {string} type
     * @param {AttributeInfoSource} attributeInfoSource
     */
    addAttributeInfoSource(type, attributeInfoSource) {
        this.attributeInfoSourcesByType[type] = attributeInfoSource;
    }

    /**
     *
     * @param {AttributeIdentifier} attribute
     */
    getAttributeInfo(attribute) {
        const source = this.attributeInfoSourcesByType[attribute.type];
        if (!source) {
            throw new Error(
                "Cannot find attribute info source for: " +
                    JSON.stringify(attribute)
            );
        }

        const info = source(attribute);
        if (info) {
            return info;
        }

        throw new Error("Unknown attribute: " + JSON.stringify(attribute));
    }

    /**
     * Sets the samples that we are working with, resets the state.
     *
     * @param {string[]} samples
     */
    setSamples(samples) {
        this.provenance.setInitialState({
            groups: [],
            rootGroup: {
                name: "ROOT",
                samples
            }
        });
    }

    /**
     * Returns a flattened group hierarchy. The result is an array of flat
     * flat hierarchies, i.e. each element is an array of groups and the
     * last group of each array is a SampleGroup which contains the samples.
     *
     * @param {State} [state] State to use, defaults to the current state.
     *      Use for mutations!
     */
    getFlattenedGroupHierarchy(state) {
        if (!state) {
            state = this.state;
        }

        /** @type {Group[]} */
        const pathStack = [];

        /** @type {Group[][]} */
        const flattenedHierarchy = [];

        /** @param {Group} group */
        const recurse = group => {
            pathStack.push(group);
            if (isGroupGroup(group)) {
                // WTF type guard not workin!
                for (const child of group.groups) {
                    recurse(child);
                }
            } else {
                flattenedHierarchy.push([...pathStack]);
            }

            pathStack.pop();
        };

        recurse(state.rootGroup);

        return flattenedHierarchy;
    }

    /**
     *
     * @param {State} [state] State to use, defaults to the current state.
     *      Use for mutations!
     */
    getSampleGroups(state) {
        return /** @type {SampleGroup[]} */ (this.getFlattenedGroupHierarchy(
            state
        ).map(path => peek(path)));
    }

    /**
     *
     * @param {any} action
     */
    dispatch(action) {
        /** @type {function(string[]):string[]} What to do for each group */
        let operation;

        const getAccessor = () =>
            this.getAttributeInfo(action.attribute).accessor;

        switch (action.type) {
            case Actions.UNDO:
                this.provenance.undo();
                return;
            case Actions.SORT_BY:
                operation = samples =>
                    sort(
                        samples,
                        wrapAccessorForComparison(
                            getAccessor(),
                            this.getAttributeInfo(action.attribute)
                        ),
                        false
                    );
                break;
            case Actions.RETAIN_FIRST_OF_EACH:
                operation = samples =>
                    retainFirstOfEach(samples, getAccessor());
                break;
            case Actions.FILTER_BY_QUANTITATIVE:
                operation = samples =>
                    filterQuantitative(
                        samples,
                        getAccessor(),
                        action.operator,
                        action.operand
                    );
                break;
            case Actions.FILTER_BY_NOMINAL:
                operation = samples =>
                    filterNominal(
                        samples,
                        getAccessor(),
                        action.action,
                        action.values
                    );
                break;
            case Actions.REMOVE_UNDEFINED:
                operation = samples => filterUndefined(samples, getAccessor());
                break;
            case Actions.GROUP_BY_NOMINAL:
                this.provenance.push(
                    produce(this.state, draftState => {
                        for (const sampleGroup of this.getSampleGroups(
                            draftState
                        )) {
                            groupSamplesByAccessor(sampleGroup, getAccessor());
                        }
                        draftState.groups.push({ name: action.attribute });
                    }),
                    action
                );
                break;
            case Actions.GROUP_TO_QUARTILES:
                this.provenance.push(
                    produce(this.state, draftState => {
                        for (const sampleGroup of this.getSampleGroups(
                            draftState
                        )) {
                            groupSamplesByQuartiles(sampleGroup, getAccessor());
                        }
                        draftState.groups.push({ name: action.attribute });
                    }),
                    action
                );
                break;
            default:
                throw new Error("Unknown action: " + JSON.stringify(action));
        }

        if (operation) {
            const newState = produce(this.state, draftState => {
                for (const sampleGroup of this.getSampleGroups(draftState)) {
                    sampleGroup.samples = operation(sampleGroup.samples);
                }
            });
            this.provenance.push(newState, action);
        }
    }
}

/**
 * @param {Group} group
 * @return {Group is SampleGroup}
 */
export function isSampleGroup(group) {
    return "samples" in group;
}

/**
 * @param {Group} group
 * @return {Group is GroupGroup}
 */
export function isGroupGroup(group) {
    return "groups" in group;
}

// ------------- TODO: own file for the following --------

/**
 *
 * @param {SampleGroup} sampleGroup
 * @param {function(any):any} accessor
 */
function groupSamplesByAccessor(sampleGroup, accessor) {
    const grouped = /** @type {Map<any, string[]>} */ (group(
        sampleGroup.samples,
        accessor
    ));

    // Transform SampleGroup into GroupGroup
    const groupGroup = /** @type {GroupGroup} */ /** @type {unknown} */ (sampleGroup);

    groupGroup.groups = [...grouped.entries()].map(([name, samples]) => ({
        name: "" + name,
        samples
    }));

    delete sampleGroup.samples;
}

/**
 *
 * @param {SampleGroup} sampleGroup
 * @param {function(any):any} accessor
 */
function groupSamplesByQuartiles(sampleGroup, accessor) {
    const quartiles = extractQuantiles(sampleGroup.samples, accessor, [
        0.25,
        0.5,
        0.75
    ]);

    groupSamplesByAccessor(
        sampleGroup,
        createQuantileAccessor(accessor, quartiles)
    );
}

/**
 * Returns an accessor that extracts a quantile-index (1-based) based
 * on the given thresholds.
 *
 * @param {function(any):any} accessor
 * @param {number[]} thresholds Must be in ascending order
 */
function createQuantileAccessor(accessor, thresholds) {
    /** @param {any} datum */
    const quantileAccessor = datum => {
        const value = accessor(datum);
        if (!isNumber(value) || isNaN(value)) {
            return undefined;
        }

        for (let i = 0; i < thresholds.length; i++) {
            // TODO: This cannot be correct...
            if (value < thresholds[i]) {
                return i;
            }
        }

        return thresholds.length;
    };

    return quantileAccessor;
}

/**
 * @param {T[]} samples
 * @param {function(T):any} accessor
 * @param {number[]} pValues
 * @returns {number[]}
 * @template T
 */
function extractQuantiles(samples, accessor, pValues) {
    const values = d3sort(
        samples.map(accessor).filter(x => isNumber(x) && !isNaN(x))
    );

    return pValues.map(p => quantileSorted(values, p));
}