import { field } from "../../utils/field";
import FlowNode, { BEHAVIOR_CLONES } from "../flowNode";

/**
 * @typedef {import("../../spec/transform").FlattenSequenceParams} FlattenSequenceParams
 */

export default class FlattenSequenceTransform extends FlowNode {
    get behavior() {
        return BEHAVIOR_CLONES;
    }

    /**
     *
     * @param {FlattenSequenceParams} params
     */
    constructor(params) {
        super();

        const accessor = field(params.field ?? "sequence");
        const [asSequence, asPos] = params.as ?? ["sequence", "pos"];

        /** @param {any[]} datum */
        this.handle = datum => {
            // TODO: Use code generation
            const template = Object.assign({}, datum, {
                [asSequence]: "",
                [asPos]: 0
            });
            const sequence = /** @type {string} */ (accessor(datum));
            for (let i = 0; i < sequence.length; i++) {
                const newObject = Object.assign({}, template);
                newObject[asSequence] = sequence.charAt(i);
                newObject[asPos] = i;
                this._propagate(newObject);
            }
        };
    }
}
