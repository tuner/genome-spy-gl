import Collector from "../data/collector";
import createTransform from "../data/transforms/transformFactory";
import createDataSource from "../data/sources/dataSourceFactory";
import UnitView from "./unitView";
import { BEHAVIOR_MODIFIES } from "../data/flowNode";
import CloneTransform from "../data/transforms/clone";
import { isDynamicCallbackData } from "../data/sources/dynamicCallbackSource";
import DataFlow from "../data/dataFlow";
import DataSource from "../data/sources/dataSource";
import {
    isChannelDefWithScale,
    isChromPosDef,
    isDatumDef,
    isFieldDef,
    isPositionalChannel,
    primaryChannel
} from "../encoder/encoder";
import LinearizeGenomicCoordinate from "../data/transforms/linearizeGenomicCoordinate";
import { isAggregateSamplesSpec } from "./viewUtils";
import { group } from "d3-array";
import IdentifierTransform from "../data/transforms/identifier";
import { expire } from "../utils/propertyCacher";

/**
 * @typedef {import("./view").default} View
 * @typedef {import("../data/flowNode").default} FlowNode
 * @typedef {import("../data/dataFlow").default<View>} DataFlow
 *
 * @param {View} root
 * @param {DataFlow<View>} [existingFlow] Add data flow
 *      graphs to an existing DataFlow object.
 */
export function buildDataFlow(root, existingFlow) {
    /** @type {FlowNode[]} "Current nodes" on the path from view root to the current view */
    const nodeStack = [];

    /** @type {FlowNode} */
    let currentNode;

    /** @type {DataFlow<View>} */
    const dataFlow = existingFlow ?? new DataFlow();

    /** @type {(function():void)[]} */
    const postProcessOps = [];

    /**
     * @param {FlowNode} node
     * @param {function():Error} [onMissingParent]
     * @returns {FlowNode} The appended node
     */
    function appendNode(node, onMissingParent = () => undefined) {
        if (!currentNode) {
            throw onMissingParent() ||
                new Error("Cannot append data flow node, no parent exist!");
        }
        currentNode.addChild(node);
        currentNode = node;
        return node;
    }

    /**
     * @param {FlowNode} transform
     * @param {any} [params]
     * @returns {FlowNode} The appended node
     */
    function appendTransform(transform, params) {
        return appendNode(
            transform,
            () =>
                new Error(
                    `Cannot append a transform because no (inherited) data are available! ${
                        params ? JSON.stringify(params) : ""
                    }`
                )
        );
    }

    /**
     *
     * @param {import("../spec/transform").TransformParams[]} transforms
     * @param {View} view
     */
    function createTransforms(transforms, view) {
        for (const params of transforms) {
            /** @type {FlowNode} */
            let transform;
            try {
                transform = createTransform(params, view);
            } catch (e) {
                console.warn(e);
                throw new Error(
                    `Cannot initialize "${params.type}" transform: ${e}`
                );
            }

            if (transform.behavior & BEHAVIOR_MODIFIES) {
                // Make defensive copies before every modifying transform to
                // ensure that modifications don't inadvertently become visible
                // in other branches of the flow.
                // These can be later optimized away where possible.
                appendTransform(new CloneTransform());
            }
            appendTransform(transform);
        }
    }

    /** @param {View} view */
    const processView = view => {
        nodeStack.push(currentNode);

        if (view.spec.data) {
            const dataSource = isDynamicCallbackData(view.spec.data)
                ? view.getDynamicDataSource()
                : createDataSource(view.spec.data, view.getBaseUrl());

            currentNode = dataSource;
            dataFlow.addDataSource(dataSource, view);
        }

        if (view.spec.transform) {
            createTransforms(view.spec.transform, view);
        }

        if (view instanceof UnitView) {
            if (!currentNode) {
                throw new Error("A unit view has no (inherited) data source");
            }

            // Support chrom/pos channelDefs
            const linearize = linearizeLocusAccess(view);
            if (linearize) {
                postProcessOps.push(linearize.rewrite);
                for (const transform of linearize.transforms) {
                    // TODO: Transforms should not be added if they already exist in the flow.
                    // Alternatively they should be optimized away.
                    // TODO: Add CloneTransform
                    appendTransform(transform);
                }
            }

            if (view.mark.isPickingParticipant()) {
                // TODO: Add CloneTransform
                appendTransform(
                    new IdentifierTransform({ type: "identifier" })
                );
            }

            const collector = new Collector({
                type: "collect",
                groupby: view.getFacetFields(),
                sort: getCompareParamsForView(
                    view,
                    linearize?.rewrittenEncoding
                )
            });

            appendNode(collector);
            dataFlow.addCollector(collector, view);
        }

        if (isAggregateSamplesSpec(view.spec)) {
            // TODO: implement summarization of layer views
        }
    };

    /** @param {View} view */
    processView.postOrder = view => {
        currentNode = nodeStack.pop();
    };

    root.visit(processView);

    postProcessOps.forEach(op => op());

    return dataFlow;
}

/**
 * Changes the ChromPos channelDefs into FieldDefs and returns
 * LinearizeGenomicCoordinate transform(s) that should be inserted into
 * the data flow.
 *
 * @param {View} view
 */
export function linearizeLocusAccess(view) {
    /** @type {FlowNode[]} */
    const transforms = [];

    /** @type {Record<string, import("../spec/channel").ChannelDef>} */
    const rewrittenEncoding = {};

    /** @type {{channel: string, chromPosDef: import("../spec/channel").ChromPosDef}[]} */
    const channelsAndChromPosDefs = [];

    // Optimize the number of transforms. Use only a single transform for positions
    // that share the chromosome field and channel.
    for (const [channel, channelDef] of Object.entries(view.getEncoding())) {
        if (isPositionalChannel(channel) && isChromPosDef(channelDef)) {
            channelsAndChromPosDefs.push({ channel, chromPosDef: channelDef });
        }
    }

    // Nngh. group uses InternMap but doesn't have a way to define an interning function.
    // Have to use multi-level grouping.
    const grouped = group(
        channelsAndChromPosDefs,
        d => /** @type {"x" | "y"} */ (primaryChannel(d.channel)),
        d => d.chromPosDef.chrom
    );

    for (const [primaryChan, chromAndStuff] of grouped.entries()) {
        for (const [chrom, chanChromPos] of chromAndStuff.entries()) {
            /** @type {string[]} */
            const pos = [];
            /** @type {string[]} */
            const as = [];

            for (const { channel, chromPosDef } of chanChromPos) {
                /** @param {string} str */
                const strip = str => str.replace(/[^A-Za-z0-9_]/g, "");
                const linearizedField = [
                    "_linearized_",
                    strip(chromPosDef.chrom),
                    "_",
                    strip(chromPosDef.pos)
                ].join("");

                // Use spec directly because getEncoding() returns inherited props too.
                /** @type {any} */
                const newFieldDef = {
                    ...(view.spec.encoding?.[channel] || {}),
                    field: linearizedField
                };
                delete newFieldDef.chrom;
                delete newFieldDef.pos;
                if (!newFieldDef.type && chromPosDef.type) {
                    newFieldDef.type = chromPosDef.type;
                }

                rewrittenEncoding[channel] = newFieldDef;

                pos.push(chromPosDef.pos);
                as.push(linearizedField);
            }

            transforms.push(
                new LinearizeGenomicCoordinate(
                    {
                        type: "linearizeGenomicCoordinate",
                        channel: primaryChan,
                        chrom: chrom,
                        pos,
                        as
                    },
                    view
                )
            );
        }
    }

    return transforms.length
        ? {
              transforms,
              rewrittenEncoding,
              /**
               * Should be called after the whole flow has been created in order to
               * not disrupt inheritance of encodings
               */
              rewrite: () => {
                  view.spec.encoding = {
                      ...view.spec.encoding,
                      ...rewrittenEncoding
                  };
                  // This is so ugly...
                  expire(view.mark, "encoding");
              }
          }
        : undefined;
}

/**
 * @param {View} view
 * @param {Record<string, import("../spec/channel").ChannelDef>} [encoding]
 * @returns {import("../spec/transform").CompareParams}
 */
function getCompareParamsForView(view, encoding) {
    // TODO: Should sort by min(x, x2).
    const e = { ...view.getEncoding(), ...encoding }.x;
    if (isChannelDefWithScale(e)) {
        if (view.getScaleResolution("x")?.isZoomable()) {
            if (isFieldDef(e)) {
                return { field: e.field };
            } else if (isDatumDef(e)) {
                // Nop
            } else {
                // TODO: Support expr by inserting a Formula transform
                throw new Error(
                    "A zoomable x channel must be mapped to a field."
                );
            }
        }
    }
}

/**
 * A helper function for creating linear data flows programmatically.
 *
 * @param {H} dataSource A data source or any other initial FlowNode.
 * @param  {...FlowNode} transforms
 * @template {FlowNode} H
 */
export function createChain(dataSource, ...transforms) {
    /** @type {FlowNode} */
    let node = dataSource;
    for (const transform of transforms) {
        node.addChild(transform);
        node = transform;
    }

    /** @type {Collector} */
    let collector;

    if (node instanceof Collector) {
        collector = node;
    } else {
        collector = new Collector();
        node.addChild(collector);
    }

    /** @type {function():Promise<Iterable<import("../data/flowNode").Datum>>} */
    let loadAndCollect;
    if (dataSource instanceof DataSource) {
        loadAndCollect = async () => {
            await dataSource.load();
            return collector.getData();
        };
    } else {
        loadAndCollect = async () => {
            throw new Error("The root node is not derived from DataSource!");
        };
    }

    return {
        dataSource,
        collector,
        loadAndCollect
    };
}
