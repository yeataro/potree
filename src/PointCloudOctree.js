

/**
 * Stands in place for invisible or unloaded octree nodes.
 * If a proxy node becomes visible and its geometry has not been loaded,
 * loading will begin.
 * If it is visible and the geometry has been loaded, the proxy node will 
 * be replaced with a point cloud node (THREE.PointCloud as of now)
 */
Potree.PointCloudOctreeProxyNode = function(geometryNode){
	THREE.Object3D.call( this );
	
	this.geometryNode = geometryNode;
	this.boundingBox = geometryNode.boundingBox;
	this.name = geometryNode.name;
	this.level = geometryNode.level;
	this.numPoints = geometryNode.numPoints;
}

Potree.PointCloudOctreeProxyNode.prototype = Object.create(THREE.Object3D.prototype);


Potree.PointCloudOctree = function(geometry, material){
	THREE.Object3D.call( this );
	
	Potree.PointCloudOctree.lru = Potree.PointCloudOctree.lru || new LRU();
	
	this.pcoGeometry = geometry;
	//this.boundingBox = this.pcoGeometry.boundingBox;
	this.boundingBox = this.pcoGeometry.root.boundingBox;
	this.material = material;
	this.maxVisibleNodes = 2000;
	this.maxVisiblePoints = 20*1000*1000;
	this.level = 0;
	
	this.LODDistance = 20;
	this.LODFalloff = 1.3;
	this.LOD = 4;
	this.showBoundingBox = false;
	
	
	var rootProxy = new Potree.PointCloudOctreeProxyNode(this.pcoGeometry.root);
	this.add(rootProxy);
}

Potree.PointCloudOctree.prototype = Object.create(THREE.Object3D.prototype);

Potree.PointCloudOctree.prototype.update = function(camera){
	this.numVisibleNodes = 0;
	this.numVisiblePoints = 0;
	
	// create frustum in object space
	camera.updateMatrixWorld();
	var frustum = new THREE.Frustum();
	var viewI = camera.matrixWorldInverse;
	var world = this.matrixWorld;
	var proj = camera.projectionMatrix;
	var fm = new THREE.Matrix4().multiply(proj).multiply(viewI).multiply(world);
	frustum.setFromMatrix( fm );
	
	// calculate camera position in object space
	var view = camera.matrixWorld;
	var worldI = new THREE.Matrix4().getInverse(world);
	var camMatrixObject = new THREE.Matrix4().multiply(worldI).multiply(view);
	var camObjPos = new THREE.Vector3().setFromMatrixPosition( camMatrixObject );
	
	var ray = new THREE.Ray(camera.position, new THREE.Vector3( 0, 0, -1 ).applyQuaternion( camera.quaternion ) );
	//var ray = new THREE.Ray(camera.position, new THREE.Vector3( 0, -1, 0 ) );
	
	// check visibility
	var stack = [];
	stack.push(this);
	while(stack.length > 0){
		var object = stack.shift();
		
		if(object instanceof THREE.Mesh || object instanceof THREE.Line ){
			object.visible = true;
			continue;
		}
		
		var box = object.boundingBox;
		var tbox = Potree.utils.computeTransformedBoundingBox(box, this.matrixWorld);
		var distance = box.center().distanceTo(camObjPos);
		var radius = box.size().length() * 0.5;

		var visible = true;
		visible = visible && frustum.intersectsBox(box);
		if(object.level > 0){
		
			{ // distance to camera method
				visible = visible && Math.pow(radius, 0.8) / distance > (1 / this.LOD);
				visible = visible && (this.numVisiblePoints + object.numPoints < Potree.pointLoadLimit);
				visible = visible && (this.numVisibleNodes <= this.maxVisibleNodes);
				visible = visible && (this.numVisiblePoints <= this.maxVisiblePoints);
			}
			
			//{ // distance to view ray method
			//	var br = tbox.size().length() / 2;
			//	var distanceToPoint = ray.distanceToPoint(tbox.center());
			//	//var m = tbox.size().length() / distanceToPoint;
			//	var m = (br - distanceToPoint) / br;
			//	m = Math.max(m+1, 1);
			//	m = Math.pow(m, 5);
			//	
			//	//visible = visible && (distanceToPoint < tbox.size().length());
			//	
			//	visible = visible && m * Math.pow(radius, 0.8) / distance > (1 / this.LOD);
			//	visible = visible && (this.numVisiblePoints + object.numPoints < Potree.pointLoadLimit);
			//	visible = visible && (this.numVisibleNodes <= this.maxVisibleNodes);
			//	visible = visible && (this.numVisiblePoints <= this.maxVisiblePoints);
			//	//visible = visible || (distanceToPoint < tbox.size().length() / 2);
			//	
			//	//document.getElementById("lblMessage").innerHTML = distanceToPoint;
			//	//if(distanceToPoint < tbox.size().length()){
			//	//	if(object.centerSphere !== undefined){
			//	//		object.centerSphere.material.color.r = 0;
			//	//		object.centerSphere.material.color.b = 1;
			//	//	}
			//	//}else{
			//	//	if(object.centerSphere !== undefined){
			//	//		object.centerSphere.material.color.r = 1;
			//	//		object.centerSphere.material.color.b = 0;
			//	//	}
			//	//}
			//}
				
			
		}else{
			visible = true;
		}
		
		if(this.pcoGeometry !== undefined && this.pcoGeometry.spacing !== undefined){
			var spacing = this.pcoGeometry.spacing / Math.pow(2, object.level);
			spacing *= 10;
			if(spacing < this.material.size * 1.5){
				visible = false;
			}
		}
		
		object.visible = visible;
		
		if(!visible){
			this.hideDescendants(object);
			continue;
		}else if(visible && this.showBoundingBox && object instanceof THREE.PointCloud){
			if(object.boundingBoxNode === undefined && object.boundingBox !== undefined){
				var boxHelper = new THREE.BoxHelper(object);
				object.add(boxHelper);
				object.boundingBoxNode = boxHelper;
			}
			//var boxHelper = new THREE.BoxHelper(node);
			//node.add(boxHelper);
			//node.boxHelper = boxHelper;
		}else if(!this.showBoundingBox){
			if(object.boundingBoxNode !== undefined){
				//object.boundingBoxNode.visible = false;
				object.remove(object.boundingBoxNode);
				object.boundingBoxNode = undefined;
			}
		}
		
		if(object instanceof THREE.PointCloud){
			this.numVisibleNodes++;
			this.numVisiblePoints += object.numPoints;
			Potree.PointCloudOctree.lru.touch(object);
		}else if (object instanceof Potree.PointCloudOctreeProxyNode) {
			this.replaceProxy(object);
		}
		
		for(var i = 0; i < object.children.length; i++){
			stack.push(object.children[i]);
		}
	}
}


Potree.PointCloudOctree.prototype.replaceProxy = function(proxy){
	
	var geometryNode = proxy.geometryNode;
	if(geometryNode.loaded === true){
		var geometry = geometryNode.geometry;
		var node = new THREE.PointCloud(geometry, this.material);
		node.name = proxy.name;
		node.level = proxy.level;
		node.numPoints = proxy.numPoints;
		node.boundingBox = geometry.boundingBox;
		node.pcoGeometry = geometryNode;
		var parent = proxy.parent;
		parent.remove(proxy);
		parent.add(node);
		
		//var centerGeometry = new THREE.SphereGeometry();
		//var material = new THREE.MeshBasicMaterial({color: 'red'});
		//var centerNode = new THREE.Mesh(centerGeometry, material);
		//centerNode.position = node.boundingBox.center();
		//var scale = 10/(node.level+1);
		//centerNode.scale.set(scale, scale, scale);
		//node.add(centerNode);
		//node.centerSphere = centerNode;
		//
		//var boxHelper = new THREE.BoxHelper(node);
		//node.add(boxHelper);
		//node.boxHelper = boxHelper;
		
		for(var i = 0; i < 8; i++){
			if(geometryNode.children[i] !== undefined){
				var child = geometryNode.children[i];
				var childProxy = new Potree.PointCloudOctreeProxyNode(child);
				node.add(childProxy);
			}
		}
	}else{
		geometryNode.load();
	}
}

Potree.PointCloudOctree.prototype.hideDescendants = function(object){
	var stack = [];
	for(var i = 0; i < object.children.length; i++){
		var child = object.children[i];
		if(child.visible){
			stack.push(child);
		}
	}
	
	while(stack.length > 0){
		var object = stack.shift();
		
		object.visible = false;
		
		for(var i = 0; i < object.children.length; i++){
			var child = object.children[i];
			if(child.visible){
				stack.push(child);
			}
		}
	}
}

Potree.PointCloudOctree.prototype.moveToOrigin = function(){
    this.position.set(0,0,0);
    this.updateMatrixWorld();
    var box = this.boundingBox;
    var transform = this.matrixWorld;
    var tBox = Potree.utils.computeTransformedBoundingBox(box, transform);
    this.position.set(0,0,0).sub(tBox.center());
}

Potree.PointCloudOctree.prototype.moveToGroundPlane = function(){
    this.updateMatrixWorld();
    var box = this.boundingBox;
    var transform = this.matrixWorld;
    var tBox = Potree.utils.computeTransformedBoundingBox(box, transform);
    this.position.y += -tBox.min.y;
}

Potree.PointCloudOctree.prototype.getBoundingBoxWorld = function(){
	this.updateMatrixWorld();
    var box = this.boundingBox;
    var transform = this.matrixWorld;
    var tBox = Potree.utils.computeTransformedBoundingBox(box, transform);
	
	return tBox;
}


/**
 *
 * amount: minimum number of points to remove
 */
Potree.PointCloudOctree.disposeLeastRecentlyUsed = function(amount){
	
	
	var freed = 0;
	do{
		var node = this.lru.first.node;
		var parent = node.parent;
		var geometry = node.geometry;
		var pcoGeometry = node.pcoGeometry;
		var proxy = new Potree.PointCloudOctreeProxyNode(pcoGeometry);
	
		var result = Potree.PointCloudOctree.disposeNode(node);
		freed += result.freed;
		
		parent.add(proxy);
		
		if(result.numDeletedNodes == 0){
			break;
		}
	}while(freed < amount);
}

Potree.PointCloudOctree.disposeNode = function(node){
	
	var freed = 0;
	var numDeletedNodes = 0;
	var descendants = [];
	
	node.traverse(function(object){
		descendants.push(object);
	});
	
	for(var i = 0; i < descendants.length; i++){
		var descendant = descendants[i];
		if(descendant instanceof THREE.PointCloud){
			freed += descendant.pcoGeometry.numPoints;
			descendant.pcoGeometry.dispose();
			descendant.geometry.dispose();
			Potree.PointCloudOctree.lru.remove(descendant);
			numDeletedNodes++;
		}
	}
	
	Potree.PointCloudOctree.lru.remove(node);
	node.parent.remove(node);
	
	return {
		"freed": freed,
		"numDeletedNodes": numDeletedNodes
	};
}