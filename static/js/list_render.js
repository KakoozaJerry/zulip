const DEFAULTS = {
    INITIAL_RENDER_COUNT: 80,
    LOAD_COUNT: 20,
    instances: new Map(),
};

exports.filter = (value, list, opts) => {
    /*
        This is used by the main object (see `create`),
        but we split it out to make it a bit easier
        to test.
    */
    if (!opts.filter) {
        return [...list];
    }

    if (opts.filter.filterer) {
        return opts.filter.filterer(list, value);
    }

    const predicate = opts.filter.predicate;

    return list.filter(function (item) {
        return predicate(item, value);
    });
};

exports.validate_filter = (opts) => {
    if (!opts.filter) {
        return;
    }
    if (opts.filter.predicate) {
        if (typeof opts.filter.predicate !== 'function') {
            blueslip.error('Filter predicate function is missing.');
            return;
        }
        if (opts.filter.filterer) {
            blueslip.error('Filterer and predicate are mutually exclusive.');
            return;
        }
    } else {
        if (typeof opts.filter.filterer !== 'function') {
            blueslip.error('Filter filterer function is missing.');
            return;
        }
    }
};

// @params
// container: jQuery object to append to.
// list: The list of items to progressively append.
// opts: An object of random preferences.
exports.create = function ($container, list, opts) {
    if (!opts) {
        blueslip.error('Need opts to create widget.');
        return;
    }

    if (opts.name && DEFAULTS.instances.get(opts.name)) {
        // Clear event handlers for prior widget.
        const old_widget = DEFAULTS.instances.get(opts.name);
        old_widget.clear_event_handlers();
    }

    const meta = {
        sorting_function: null,
        sorting_functions: new Map(),
        generic_sorting_functions: new Map(),
        offset: 0,
        list: list,
        filtered_list: list,
        reverse_mode: false,
        filter_value: '',
    };

    exports.validate_filter(opts);

    const widget = {};

    widget.filter_and_sort = function () {
        meta.filtered_list = exports.filter(
            meta.filter_value,
            meta.list,
            opts
        );

        if (meta.sorting_function) {
            meta.filtered_list.sort(
                meta.sorting_function
            );
        }

        if (meta.reverse_mode) {
            meta.filtered_list.reverse();
        }
    };

    // Reads the provided list (in the scope directly above)
    // and renders the next block of messages automatically
    // into the specified container.
    widget.render = function (how_many) {
        const load_count = how_many || DEFAULTS.LOAD_COUNT;

        // Stop once the offset reaches the length of the original list.
        if (meta.offset >= meta.filtered_list.length) {
            return;
        }

        const slice = meta.filtered_list.slice(meta.offset, meta.offset + load_count);

        const finish = blueslip.start_timing('list_render ' + opts.name);
        let html = "";
        for (const item of slice) {
            const s = opts.modifier(item);

            if (typeof s !== 'string') {
                blueslip.error('List item is not a string: ' + s);
                continue;
            }

            // append the HTML or nothing if corrupt (null, undef, etc.).
            if (s) {
                html += s;
            }
        }

        finish();

        $container.append($(html));
        meta.offset += load_count;
    };

    widget.clear = function () {
        $container.html("");
        meta.offset = 0;
    };

    widget.set_filter_value = function (filter_value) {
        meta.filter_value = filter_value;
    };

    widget.set_reverse_mode = function (reverse_mode) {
        meta.reverse_mode = reverse_mode;
    };

    // the sorting function is either the function or string that calls the
    // function to sort the list by. The prop is used for generic functions
    // that can be called to sort with a particular prop.
    widget.set_sorting_function = function (sorting_function, prop) {
        if (typeof sorting_function === "function") {
            meta.sorting_function = sorting_function;
        } else if (typeof sorting_function === "string") {
            if (typeof prop === "string") {
                /* eslint-disable max-len */
                meta.sorting_function = meta.generic_sorting_functions.get(sorting_function)(prop);
            } else {
                meta.sorting_function = meta.sorting_functions.get(sorting_function);
            }
        }
    };

    // generic sorting functions are ones that will use a specified prop
    // and perform a sort on it with the given sorting function.
    widget.add_generic_sort_function = function (name, sorting_function) {
        meta.generic_sorting_functions.set(name, sorting_function);
    };

    widget.set_up_event_handlers = function () {
        meta.scroll_container = scroll_util.get_list_scrolling_container($container);

        // on scroll of the nearest scrolling container, if it hits the bottom
        // of the container then fetch a new block of items and render them.
        meta.scroll_container.on('scroll.list_widget_container', function () {
            if (this.scrollHeight - (this.scrollTop + this.clientHeight) < 10) {
                widget.render();
            }
        });

        if (opts.parent_container) {
            opts.parent_container.on('click.list_widget_sort', "[data-sort]", function () {
                exports.handle_sort($(this), widget);
            });
        }

        if (opts.filter && opts.filter.element) {
            opts.filter.element.on('input.list_widget_filter', function () {
                const value = this.value.toLocaleLowerCase();
                widget.set_filter_value(value);
                widget.hard_redraw();
            });
        }
    };

    widget.clear_event_handlers = function () {
        meta.scroll_container.off('scroll.list_widget_container');

        if (opts.parent_container) {
            opts.parent_container.off('click.list_widget_sort', "[data-sort]");
        }

        if (opts.filter && opts.filter.element) {
            opts.filter.element.off('input.list_widget_filter');
        }
    };

    widget.sort = function (sorting_function, prop) {
        widget.set_sorting_function(sorting_function, prop);
        widget.hard_redraw();
    };

    widget.clean_redraw = function () {
        widget.filter_and_sort();
        widget.clear();
        widget.render(DEFAULTS.INITIAL_RENDER_COUNT);
    };

    widget.hard_redraw = function () {
        widget.clean_redraw();
        if (opts.filter && opts.filter.onupdate) {
            opts.filter.onupdate();
        }
    };

    widget.replace_list_data = function (list) {
        /*
            We mostly use this widget for lists where you are
            not adding or removing rows, so when you do modify
            the list, we have a brute force solution.
        */
        meta.list = list;
        widget.hard_redraw();
    };

    // add built-in generic sort functions.
    widget.add_generic_sort_function("alphabetic", function (prop) {
        return function (a, b) {
            // The conversion to uppercase helps make the sorting case insensitive.
            const str1 = a[prop].toUpperCase();
            const str2 = b[prop].toUpperCase();

            if (str1 === str2) {
                return 0;
            } else if (str1 > str2) {
                return 1;
            }

            return -1;
        };
    });

    widget.add_generic_sort_function("numeric", function (prop) {
        return function (a, b) {
            if (parseFloat(a[prop]) > parseFloat(b[prop])) {
                return 1;
            } else if (parseFloat(a[prop]) === parseFloat(b[prop])) {
                return 0;
            }

            return -1;
        };
    });

    widget.set_up_event_handlers();

    if (opts.sort_fields) {
        for (const [name, sorting_function] of Object.entries(opts.sort_fields)) {
            meta.sorting_functions.set(name, sorting_function);
        }
    }

    if (opts.init_sort) {
        widget.set_sorting_function(...opts.init_sort);
    }

    widget.clean_redraw();

    // Save the instance for potential future retrieval if a name is provided.
    if (opts.name) {
        DEFAULTS.instances.set(opts.name, widget);
    }

    return widget;
};

exports.get = function (name) {
    return DEFAULTS.instances.get(name) || false;
};

exports.handle_sort = function (th, list) {
    /*
        one would specify sort parameters like this:
            - name => sort alphabetic.
            - age  => sort numeric.
            - status => look up `status` in sort_fields
                        to find custom sort function

        <thead>
            <th data-sort="alphabetic" data-sort-prop="name"></th>
            <th data-sort="numeric" data-sort-prop="age"></th>
            <th data-sort="status"></th>
        </thead>
        */
    const sort_type = th.data("sort");
    const prop_name = th.data("sort-prop");

    if (th.hasClass("active")) {
        if (!th.hasClass("descend")) {
            th.addClass("descend");
        } else {
            th.removeClass("descend");
        }
    } else {
        th.siblings(".active").removeClass("active");
        th.addClass("active");
    }

    list.set_reverse_mode(th.hasClass("descend"));

    // if `prop_name` is defined, it will trigger the generic codepath,
    // and not if it is undefined.
    list.sort(sort_type, prop_name);
};

window.list_render = exports;
