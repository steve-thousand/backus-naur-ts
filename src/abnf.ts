import { TokenStream, TokenStreamLease, TokenStreamPredicate, LiteralPredicate, RangePredicate } from './reader';
import { SyntaxNode, RuleSyntaxNode, TokenSyntaxNode, SimpleSyntaxNode } from './ast'

export type RuleMap = Map<string, Rule>

export abstract class RuleElement {
    /**
     * Every {@link RuleElement} must define how it should consume a {@link TokenStream}
     * @param stream the {@link TokenStream} to consume
     */
    abstract consume(stream: TokenStream, rules: RuleMap): SyntaxNode
}

/**
 * An element referencing a {@link Rule} by name.
 */
export class RuleRef extends RuleElement {

    ruleName: string

    constructor(ruleName: string) {
        super()
        this.ruleName = ruleName
    }

    consume(stream: TokenStream, rules: RuleMap): SyntaxNode {
        if (!rules.has(this.ruleName)) {
            throw `Failed to find rule by name '${this.ruleName}'`
        }
        return rules.get(this.ruleName).consume(stream, rules)
    }
}

/**
 * A class wrapping a sequence of {@link RuleElement | RuleElements}. All elements must successfully match the token
 * stream.
 */
abstract class Sequence extends RuleElement {

    elements: RuleElement[]

    constructor(elements: RuleElement[]) {
        super()
        this.elements = elements;
    }

    consume(stream: TokenStream, rules: RuleMap): SyntaxNode {
        const wrapperNode = new SimpleSyntaxNode()
        for (let element of this.elements) {
            const node = element.consume(stream, rules)
            if (node == null) {
                //failed to match on this element in the sequence
                wrapperNode.release()
                return null
            } else {
                wrapperNode.addChild(node)
            }
        }
        return wrapperNode
    }
}

export class Group extends Sequence { }

/**
 * Wraps a group of elements that are optional, meaning that they must match the stream a minimum of 0 times and a 
 * maximum of 1 times
 */
export class Optional extends Sequence {

    private repetition: Repetition

    constructor(elements: RuleElement[]) {
        super(elements)
        //an Optional element is equal to an element wrapped in a Repetition of at most 1
        this.repetition = new Repetition(0, 1, new Group(elements))
    }

    consume(stream: TokenStream, rules: RuleMap): SyntaxNode {
        return this.repetition.consume(stream, rules)
    }
}

/**
 * Separates a series of rule element sets, and at least one must match the token stream.
 */
export class Alternative extends RuleElement {

    alternatives: RuleElement[]

    constructor(alternatives: RuleElement[]) {
        super()
        this.alternatives = alternatives
    }

    consume(stream: TokenStream, rules: RuleMap): SyntaxNode {
        for (let alternative of this.alternatives) {
            const node = alternative.consume(stream, rules);
            if (node !== null) {
                return node
            }
        }
        //failed to find a match
        return null
    }
}

/**
 * A class which applies a {@link TokenStreamPredicate} to the {@link TokenStream} that it consumes.
 */
abstract class PredicateElement extends RuleElement {

    predicate: TokenStreamPredicate

    constructor(predicate: TokenStreamPredicate) {
        super()
        this.predicate = predicate
    }

    consume(stream: TokenStream, rules: RuleMap): SyntaxNode {
        const lease: TokenStreamLease = stream.consume(this.predicate)
        if (lease !== null) {
            return new TokenSyntaxNode(lease)
        } else {
            return null
        }
    }
}

/**
 * Represents a literal character sequence that must be matched exactly.
 */
export class Literal extends PredicateElement {
    constructor(value: string) {
        super(new LiteralPredicate(value))
    }
}

/**
 * Represents a decimal range that a character must fall within, inclusive.
 */
export class CharRange extends PredicateElement {
    constructor(minimum: number, maximum: number) {
        super(new RangePredicate(minimum, maximum))
    }
}

/**
 * Wraps a {@link RuleElement} with the numerical information describing the minimum and maximum amount of times the
 * token stream must match it.
 */
export class Repetition extends RuleElement {

    atleast: number
    atMost: number
    element: RuleElement

    constructor(atleast: number, atMost: number, element: RuleElement) {
        super()
        this.atleast = atleast
        this.atMost = atMost
        this.element = element
    }

    /**
     * Overrides superclass {@link RuleElement#consume} method to attempt matching multiple times, according to the
     * repetition minimum and maximum requirements.
     * @override
     */
    consume(stream: TokenStream, rules: RuleMap): SyntaxNode {
        let matched = 0
        const wrapperNode = new SimpleSyntaxNode()
        while (true) {
            //exit early if we have reached the maximum amount
            if (matched >= this.atMost) {
                break
            }
            const childNode = this.element.consume(stream, rules)
            if (childNode == null) {
                break
            } else {
                wrapperNode.addChild(childNode)
            }
            matched++
        }

        //release and return null if we have not met the minimum requirement
        if (wrapperNode.children.length < this.atleast || wrapperNode.children.length > this.atMost) {
            wrapperNode.release()
            return null
        } else {
            return wrapperNode
        }
    }
}

/**
 * TODO: uhhh should these consume in the same way as the elements???
 * Maybe syntax nodes can only be constructed when a Rule is matched, not a rule element.
 */
export class Rule {

    name: string
    elements: RuleElement[]

    constructor(name: string, elements: RuleElement[]) {
        this.name = name
        this.elements = elements
    }

    /**
     * Attempts to consume a portion of a TokenStream that matches this element.
     * @param stream {@link TokenStream} to attemp to consume
     * @return an AST node that claims a lease on a matching portion of the stream. null, if no match found
     */
    consume(stream: TokenStream, rules: RuleMap): RuleSyntaxNode {
        const node = new RuleSyntaxNode(this.name)
        for (let element of this.elements) {
            let childNode = element.consume(stream, rules)
            if (childNode == null) {
                node.release()
                return null
            } else {
                node.addChild(childNode)
            }
        }
        return node
    }
}
