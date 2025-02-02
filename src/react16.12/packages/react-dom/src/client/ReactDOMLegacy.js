/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { DOMContainer } from "./ReactDOM";
import type { RootType } from "./ReactDOMRoot";
import type { ReactNodeList } from "shared/ReactTypes";

import {
    getInstanceFromNode,
    isContainerMarkedAsRoot,
    unmarkContainerAsRoot
} from "./ReactDOMComponentTree";
import {
    createLegacyRoot,
    isValidContainer,
    warnOnInvalidCallback
} from "./ReactDOMRoot";
import { ROOT_ATTRIBUTE_NAME } from "../shared/DOMProperty";
import {
    DOCUMENT_NODE,
    ELEMENT_NODE,
    COMMENT_NODE
} from "../shared/HTMLNodeType";

import {
    findHostInstanceWithNoPortals,
    updateContainer,
    unbatchedUpdates,
    getPublicRootInstance,
    findHostInstance,
    findHostInstanceWithWarning
} from "react-reconciler/inline.dom";
import getComponentName from "shared/getComponentName";
import invariant from "shared/invariant";
import lowPriorityWarningWithoutStack from "shared/lowPriorityWarningWithoutStack";
import warningWithoutStack from "shared/warningWithoutStack";
import ReactSharedInternals from "shared/ReactSharedInternals";
import { has as hasInstance } from "shared/ReactInstanceMap";

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let topLevelUpdateWarnings;
let warnedAboutHydrateAPI = false;

if (__DEV__) {
    topLevelUpdateWarnings = (container: DOMContainer) => {
        if (
            container._reactRootContainer &&
            container.nodeType !== COMMENT_NODE
        ) {
            const hostInstance = findHostInstanceWithNoPortals(
                container._reactRootContainer._internalRoot.current
            );
            if (hostInstance) {
                warningWithoutStack(
                    hostInstance.parentNode === container,
                    "render(...): It looks like the React-rendered content of this " +
                        "container was removed without using React. This is not " +
                        "supported and will cause errors. Instead, call " +
                        "ReactDOM.unmountComponentAtNode to empty a container."
                );
            }
        }

        const isRootRenderedBySomeReact = !!container._reactRootContainer;
        const rootEl = getReactRootElementInContainer(container);
        const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

        warningWithoutStack(
            !hasNonRootReactChild || isRootRenderedBySomeReact,
            "render(...): Replacing React-rendered children with a new root " +
                "component. If you intended to update the children of this node, " +
                "you should instead have the existing children update their state " +
                "and render the new components instead of calling ReactDOM.render."
        );

        warningWithoutStack(
            container.nodeType !== ELEMENT_NODE ||
                !((container: any): Element).tagName ||
                ((container: any): Element).tagName.toUpperCase() !== "BODY",
            "render(): Rendering components directly into document.body is " +
                "discouraged, since its children are often manipulated by third-party " +
                "scripts and browser extensions. This may lead to subtle " +
                "reconciliation issues. Try rendering into a container element created " +
                "for your app."
        );
    };
}

function getReactRootElementInContainer(container: any) {
    if (!container) {
        return null;
    }

    if (container.nodeType === DOCUMENT_NODE) {
        return container.documentElement;
    } else {
        return container.firstChild;
    }
}

function shouldHydrateDueToLegacyHeuristic(container) {
    const rootElement = getReactRootElementInContainer(container);
    return !!(
        rootElement &&
        rootElement.nodeType === ELEMENT_NODE &&
        rootElement.hasAttribute(ROOT_ATTRIBUTE_NAME)
    );
}

function legacyCreateRootFromDOMContainer(
    container: DOMContainer,
    forceHydrate: boolean
): RootType {
    const shouldHydrate =
        forceHydrate || shouldHydrateDueToLegacyHeuristic(container);
    // First clear any existing content.
    if (!shouldHydrate) {
        let warned = false;
        let rootSibling;
        while ((rootSibling = container.lastChild)) {
            if (__DEV__) {
                if (
                    !warned &&
                    rootSibling.nodeType === ELEMENT_NODE &&
                    (rootSibling: any).hasAttribute(ROOT_ATTRIBUTE_NAME)
                ) {
                    warned = true;
                    warningWithoutStack(
                        false,
                        "render(): Target node has markup rendered by React, but there " +
                            "are unrelated nodes as well. This is most commonly caused by " +
                            "white-space inserted around server-rendered markup."
                    );
                }
            }
            container.removeChild(rootSibling);
        }
    }
    if (__DEV__) {
        if (shouldHydrate && !forceHydrate && !warnedAboutHydrateAPI) {
            warnedAboutHydrateAPI = true;
            lowPriorityWarningWithoutStack(
                false,
                "render(): Calling ReactDOM.render() to hydrate server-rendered markup " +
                    "will stop working in React v17. Replace the ReactDOM.render() call " +
                    "with ReactDOM.hydrate() if you want React to attach to the server HTML."
            );
        }
    }

    return createLegacyRoot(
        container,
        shouldHydrate
            ? {
                  hydrate: true
              }
            : undefined
    );
}

function legacyRenderSubtreeIntoContainer(
    parentComponent: ?React$Component<any, any>,
    children: ReactNodeList,
    container: DOMContainer,
    forceHydrate: boolean,
    callback: ?Function
) {
    if (__DEV__) {
        topLevelUpdateWarnings(container);
        warnOnInvalidCallback(
            callback === undefined ? null : callback,
            "render"
        );
    }

    // TODO: Without `any` type, Flow says "Property cannot be accessed on any
    // member of intersection type."
    let root: RootType = (container._reactRootContainer: any);
    let fiberRoot;
    if (!root) {
        // Initial mount
        //初次挂载
        root = container._reactRootContainer = legacyCreateRootFromDOMContainer(
            container,
            forceHydrate
        );
        fiberRoot = root._internalRoot;
        // console.log("初次挂载 fiberRoot", fiberRoot);
        if (typeof callback === "function") {
            const originalCallback = callback;
            callback = function() {
                const instance = getPublicRootInstance(fiberRoot);
                originalCallback.call(instance);
            };
        }
        // Initial mount should not be batched.
        unbatchedUpdates(() => {
            updateContainer(children, fiberRoot, parentComponent, callback);
        });
    } else {
        fiberRoot = root._internalRoot;
        // console.log("不是初次挂载 fiberRoot", fiberRoot);
        if (typeof callback === "function") {
            const originalCallback = callback;
            callback = function() {
                const instance = getPublicRootInstance(fiberRoot);
                originalCallback.call(instance);
            };
        }
        // Update
        updateContainer(children, fiberRoot, parentComponent, callback);
    }
    return getPublicRootInstance(fiberRoot);
}

export function findDOMNode(
    componentOrElement: Element | ?React$Component<any, any>
): null | Element | Text {
    if (__DEV__) {
        let owner = (ReactCurrentOwner.current: any);
        if (owner !== null && owner.stateNode !== null) {
            const warnedAboutRefsInRender =
                owner.stateNode._warnedAboutRefsInRender;
            warningWithoutStack(
                warnedAboutRefsInRender,
                "%s is accessing findDOMNode inside its render(). " +
                    "render() should be a pure function of props and state. It should " +
                    "never access something that requires stale data from the previous " +
                    "render, such as refs. Move this logic to componentDidMount and " +
                    "componentDidUpdate instead.",
                getComponentName(owner.type) || "A component"
            );
            owner.stateNode._warnedAboutRefsInRender = true;
        }
    }
    if (componentOrElement == null) {
        return null;
    }
    if ((componentOrElement: any).nodeType === ELEMENT_NODE) {
        return (componentOrElement: any);
    }
    if (__DEV__) {
        return findHostInstanceWithWarning(componentOrElement, "findDOMNode");
    }
    return findHostInstance(componentOrElement);
}

export function hydrate(
    element: React$Node,
    container: DOMContainer,
    callback: ?Function
) {
    invariant(
        isValidContainer(container),
        "Target container is not a DOM element."
    );
    if (__DEV__) {
        const isModernRoot =
            isContainerMarkedAsRoot(container) &&
            container._reactRootContainer === undefined;
        if (isModernRoot) {
            warningWithoutStack(
                false,
                "You are calling ReactDOM.hydrate() on a container that was previously " +
                    "passed to ReactDOM.createRoot(). This is not supported. " +
                    "Did you mean to call createRoot(container, {hydrate: true}).render(element)?"
            );
        }
    }
    // TODO: throw or warn if we couldn't hydrate?
    return legacyRenderSubtreeIntoContainer(
        null,
        element,
        container,
        true,
        callback
    );
}

export function render(
    element: React$Element<any>,
    container: DOMContainer,
    callback: ?Function
) {
    invariant(
        isValidContainer(container),
        "Target container is not a DOM element."
    );
    if (__DEV__) {
        const isModernRoot =
            isContainerMarkedAsRoot(container) &&
            container._reactRootContainer === undefined;
        if (isModernRoot) {
            warningWithoutStack(
                false,
                "You are calling ReactDOM.render() on a container that was previously " +
                    "passed to ReactDOM.createRoot(). This is not supported. " +
                    "Did you mean to call root.render(element)?"
            );
        }
    }
    return legacyRenderSubtreeIntoContainer(
        null,
        element,
        container,
        false,
        callback
    );
}

export function unstable_renderSubtreeIntoContainer(
    parentComponent: React$Component<any, any>,
    element: React$Element<any>,
    containerNode: DOMContainer,
    callback: ?Function
) {
    invariant(
        isValidContainer(containerNode),
        "Target container is not a DOM element."
    );
    invariant(
        parentComponent != null && hasInstance(parentComponent),
        "parentComponent must be a valid React Component"
    );
    return legacyRenderSubtreeIntoContainer(
        parentComponent,
        element,
        containerNode,
        false,
        callback
    );
}

export function unmountComponentAtNode(container: DOMContainer) {
    invariant(
        isValidContainer(container),
        "unmountComponentAtNode(...): Target container is not a DOM element."
    );

    if (__DEV__) {
        const isModernRoot =
            isContainerMarkedAsRoot(container) &&
            container._reactRootContainer === undefined;
        if (isModernRoot) {
            warningWithoutStack(
                false,
                "You are calling ReactDOM.unmountComponentAtNode() on a container that was previously " +
                    "passed to ReactDOM.createRoot(). This is not supported. Did you mean to call root.unmount()?"
            );
        }
    }

    if (container._reactRootContainer) {
        if (__DEV__) {
            const rootEl = getReactRootElementInContainer(container);
            const renderedByDifferentReact =
                rootEl && !getInstanceFromNode(rootEl);
            warningWithoutStack(
                !renderedByDifferentReact,
                "unmountComponentAtNode(): The node you're attempting to unmount " +
                    "was rendered by another copy of React."
            );
        }

        // Unmount should not be batched.
        unbatchedUpdates(() => {
            legacyRenderSubtreeIntoContainer(
                null,
                null,
                container,
                false,
                () => {
                    container._reactRootContainer = null;
                    unmarkContainerAsRoot(container);
                }
            );
        });
        // If you call unmountComponentAtNode twice in quick succession, you'll
        // get `true` twice. That's probably fine?
        return true;
    } else {
        if (__DEV__) {
            const rootEl = getReactRootElementInContainer(container);
            const hasNonRootReactChild = !!(
                rootEl && getInstanceFromNode(rootEl)
            );

            // Check if the container itself is a React root node.
            const isContainerReactRoot =
                container.nodeType === ELEMENT_NODE &&
                isValidContainer(container.parentNode) &&
                !!container.parentNode._reactRootContainer;

            warningWithoutStack(
                !hasNonRootReactChild,
                "unmountComponentAtNode(): The node you're attempting to unmount " +
                    "was rendered by React and is not a top-level container. %s",
                isContainerReactRoot
                    ? "You may have accidentally passed in a React root node instead " +
                          "of its container."
                    : "Instead, have the parent component update its state and " +
                          "rerender in order to remove this component."
            );
        }

        return false;
    }
}
