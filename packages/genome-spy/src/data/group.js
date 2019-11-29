export class Group {
    /**
     * @param {string | number | boolean} key
     */
    constructor(key) {
        this.key = key;
    }

    /**
     * Clones the group hierarchy and applies the given transformer to each data array
     *
     * @param {function(object[]):object[]} transformer
     * @returns {Group}
     */
    map(transformer) {}

    /**
     * @returns {Group}
     */
    ungroup() {
        throw new Error("Abstract");
    }

    ungroupAll() {
        /** @type {Group} */
        let group = this;
        while (group instanceof GroupGroup) {
            group = group.ungroup();
        }
        return /** @type {DataGroup} */ (group);
    }

    /**
     * Returns an iterable that yields flattened data
     */
    flatData() {
        const flattened = this._collectDataGroups();

        let gi = 0;
        let arr = flattened[gi].data;

        let ai = 0;

        return {
            [Symbol.iterator]() {
                return this;
            },
            next() {
                if (arr && ai < arr.length) {
                    return { value: arr[ai++] };
                }

                gi++;

                if (gi < flattened.length) {
                    arr = flattened[gi].data;
                    ai = 0;

                    return this.next();
                } else {
                    return { done: true };
                }
            }
        };
    }

    /**
     * @returns {DataGroup[]}
     */
    _collectDataGroups() {
        throw new Error("Abstract");
    }
}

export class DataGroup extends Group {
    /**
     * @param {string | number | boolean} key
     * @param {object[]} data
     */
    constructor(key, data) {
        super(key);
        this.data = data;
    }

    map(transformer) {
        return new DataGroup(this.key, transformer(this.data));
    }

    /**
     * @returns {Group}
     */
    ungroup() {
        throw new Error("Trying to ungroup a DataGroup!");
    }

    _collectDataGroups() {
        return [this];
    }
}

export class GroupGroup extends Group {
    /**
     * @param {string | number | boolean} key
     * @param {Group[]} subgroups
     */
    constructor(key, subgroups) {
        super(key);
        this.subgroups = subgroups;
    }

    hasDataChildren() {
        // All children should be of same type. Just check the first child.
        return this.subgroups[0] instanceof DataGroup;
    }

    map(transformer) {
        return new GroupGroup(
            this.key,
            this.subgroups.map(g => g.map(transformer))
        );
    }

    /**
     * @returns {Group}
     */
    ungroup() {
        if (this.hasDataChildren()) {
            // TODO: Option to add field based on the group key
            // TODO: Check that each group has equal fields!
            const groups = /** @type {DataGroup[]} */ (this.subgroups)
                .map(g => g.data)
                .flat();
            return new DataGroup(this.key, groups);
        } else {
            return new GroupGroup(
                this.key,
                /** @type {GroupGroup[]} */ (this.subgroups).map(g =>
                    g.ungroup()
                )
            );
        }
    }

    _collectDataGroups() {
        return this.subgroups.map(g => g._collectDataGroups()).flat();
    }
}
