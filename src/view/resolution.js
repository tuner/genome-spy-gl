import {
    isString
} from 'vega-util';

import mergeObjects from '../utils/mergeObjects';

/**
 * @typedef {import("../utils/domainArray").DomainArray} DomainArray 
 * @typedef {import("../utils/interval").default} Interval
 * @typedef { import("./unitView").default} UnitView
 */

export default class Resolution {
    /**
     * @param {string} channel
     */
    constructor(channel) {
        this.channel = channel;
        /** @type {import("./unitView").default[]} */
        this.views = [];
        this.scale = { }
        /** @type {string} */
        this.type = null;
    }

    /**
     * N.B. This is expected to be called in depth-first order
     * 
     * @param {UnitView} view
     */
    pushUnitView(view) {
        const type = this._getEncoding(view).type;
        if (!this.type) {
            this.type = type;
        } else if (type !== this.type) {
            // TODO: Include a reference to the layer
            throw new Error(`Can not use shared scale for different data types: ${this.type} vs. ${type}. Use "resolve: independent" for channel ${this.channel}`)
            
        }

        this.views.push(view);

        // TODO: Merge scale
    }

    getAxisProps() {
        const propArray = this.views
            .map(view => this._getEncoding(view).axis);
        
        if (propArray.length > 0 && propArray.every(props => props === null)) {
            // No axis whatsoever is wanted
            return null;
        } else {
            return mergeObjects(propArray.filter(props => props !== undefined), "axis", ["title"]);
        }
    }

    getTitle() {
        /** @param {UnitView} view} */
        const computeTitle = view => {
            const encodingSpec = this._getEncoding(view);

            // Retain nulls as they indicate that no title should be shown
            return [
                encodingSpec.axis === null ? null : undefined,
                encodingSpec.axis !== null && typeof encodingSpec.axis === "object" ? encodingSpec.axis.title : undefined,
                encodingSpec.title,
                encodingSpec.field
            ]
                .filter(title => title !== undefined)
                .shift();
        };

        return [...new Set(
            this.views
                .map(computeTitle)
                .filter(isString)
        )]
            .join(", ");
    }

    /**
     * @return { DomainArray }
     */
    getDomain() {
        const domains = this.views.map(view => view.getDomain(this.channel));
        if (domains.length > 1) {
            return domains
                .filter(domain => domain)
                .reduce((acc, curr) => acc.extendAll(curr));

        } else if (domains.length === 1) {
            return domains[0];
        }

        // TODO: Better error message
        throw new Error("Cannot resolve domain!");
    }

    getScale() {
        // TODO: Merge and build a scale
        throw new Error("TODO");
    }

    /**
     * 
     * @param {UnitView} view 
     */
    _getEncoding(view) {
        return view.getEncoding()[this.channel];
    }
}
